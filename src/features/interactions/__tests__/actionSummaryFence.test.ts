import { describe, expect, it } from 'vitest';
import {
  extractActionSummary,
  formatActionSummaryFence,
} from '../actionSummaryFence';

describe('extractActionSummary', () => {
  it('extracts a trailing :::summary fence', () => {
    const raw = [
      '# SHM',
      '',
      'Displacement follows a cosine.',
      '',
      ':::graph',
      'expression: cos(x)',
      ':::',
      '',
      ':::summary',
      'Created an SHM lesson with a cos(x) graph.',
      ':::',
    ].join('\n');

    const result = extractActionSummary(raw);
    expect(result.found).toBe(true);
    expect(result.summary).toBe('Created an SHM lesson with a cos(x) graph.');
    expect(result.body).toContain(':::graph');
    expect(result.body).not.toContain(':::summary');
    expect(result.body).not.toContain('Created an SHM lesson');
  });

  it('unwraps ```markdown then extracts summary', () => {
    const raw = [
      '```markdown',
      'Hello world',
      '',
      ':::summary',
      'Added a greeting note.',
      ':::',
      '```',
    ].join('\n');
    const result = extractActionSummary(raw);
    expect(result.summary).toBe('Added a greeting note.');
    expect(result.body.trim()).toBe('Hello world');
  });

  it('ignores :::summary inside a code fence', () => {
    const raw = [
      'Example:',
      '',
      '```text',
      ':::summary',
      'not real',
      ':::',
      '```',
      '',
      ':::summary',
      'Real summary.',
      ':::',
    ].join('\n');
    const result = extractActionSummary(raw);
    expect(result.summary).toBe('Real summary.');
    expect(result.body).toContain('not real');
  });

  it('returns null summary when fence is absent', () => {
    const result = extractActionSummary('# Just a heading\n\nProse.');
    expect(result.found).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.body).toContain('Just a heading');
  });

  it('formatActionSummaryFence round-trips', () => {
    const fence = formatActionSummaryFence('Did the thing.');
    expect(fence).toBe(':::summary\nDid the thing.\n:::');
    expect(extractActionSummary(`Body\n\n${fence}`).summary).toBe('Did the thing.');
  });

  it('extracts :::summary placed after the closing ```markdown fence', () => {
    const raw = [
      '```markdown',
      '# Title',
      '',
      'Body prose.',
      '```',
      '',
      ':::summary',
      'Created a titled note.',
      ':::',
    ].join('\n');
    const result = extractActionSummary(raw);
    expect(result.found).toBe(true);
    expect(result.summary).toBe('Created a titled note.');
    expect(result.body.trim()).toBe('# Title\n\nBody prose.');
    expect(result.body).not.toContain('```');
  });
});
