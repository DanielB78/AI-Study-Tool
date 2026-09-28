import { describe, expect, it } from 'vitest';
import { summarizeAiActions } from '../../ai/agent/actionSummary';
import type { CanvasOperation } from '../../ai/agent/operations';

describe('summarizeAiActions', () => {
  it('summarizes a single create_text with relative placement', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'create_text',
        text: 'Flux through a closed surface.',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_18',
          relation: 'below',
        },
      },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'Add a note about flux',
      operations: ops,
      createdIds: ['textbox_22'],
    });
    expect(summary).toContain('Created textbox textbox_22');
    expect(summary).toContain('below textbox textbox_18');
    expect(summary).toContain('flux');
  });

  it('summarizes a single update_text', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'update_text',
        target_element_id: 'textbox_18',
        text: 'Updated Gauss law text.',
      },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'Clarify the Gauss note',
      operations: ops,
      elementPreviews: {
        textbox_18: { id: 'textbox_18', text: 'Old Gauss', exists: true },
      },
    });
    expect(summary).toContain('Updated textbox textbox_18');
  });

  it('summarizes multiple operations', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'create_text',
        text: 'A',
        placement: { mode: 'viewport_default' },
      },
      {
        type: 'update_text',
        target_element_id: 'textbox_18',
        text: 'B',
      },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'do both',
      operations: ops,
      createdIds: ['textbox_99'],
    });
    expect(summary).toContain('Created textbox_99');
    expect(summary).toContain('updated textbox_18');
  });

  it('handles empty operations', () => {
    expect(
      summarizeAiActions({ userPrompt: 'x', operations: [] }),
    ).toBe('No canvas changes were applied.');
  });
});
