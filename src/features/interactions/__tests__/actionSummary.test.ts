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

  it('summarizes a single move_text', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'move_text',
        target_element_id: 'textbox_18',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_42',
          relation: 'below',
        },
      },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'Move the Gauss note below the other one',
      operations: ops,
    });
    expect(summary).toBe('Moved textbox textbox_18 below textbox textbox_42.');
  });

  it('summarizes a single resize_text', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'resize_text',
        target_element_id: 'textbox_18',
        width: 360,
        height: 120,
      },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'Make it bigger',
      operations: ops,
    });
    expect(summary).toBe('Resized textbox textbox_18 to 360 × 120.');
  });

  it('summarizes a single delete_text', () => {
    const ops: CanvasOperation[] = [
      { type: 'delete_text', target_element_id: 'textbox_18' },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'Delete the Gauss note',
      operations: ops,
      elementPreviews: {
        textbox_18: { id: 'textbox_18', text: 'Old Gauss law notes', exists: true },
      },
    });
    expect(summary).toContain('Deleted textbox textbox_18');
    expect(summary).toContain('Old Gauss law notes');
  });

  it('summarizes multiple move/resize/delete operations', () => {
    const ops: CanvasOperation[] = [
      {
        type: 'move_text',
        target_element_id: 'textbox_1',
        placement: { mode: 'absolute', x: 10, y: 20 },
      },
      {
        type: 'resize_text',
        target_element_id: 'textbox_2',
        width: 300,
      },
      { type: 'delete_text', target_element_id: 'textbox_3' },
    ];
    const summary = summarizeAiActions({
      userPrompt: 'rearrange',
      operations: ops,
    });
    expect(summary).toBe('Moved textbox_1, resized textbox_2 and deleted textbox_3.');
  });
});
