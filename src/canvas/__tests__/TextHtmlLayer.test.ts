import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type TextElement } from '../../types/canvas';
import { buildFeatureHtml } from '../TextHtmlLayer';
import { textElementNeedsHtmlOverlay } from '../../features/text/textFeatures';

function makeText(partial: Partial<TextElement> & Pick<TextElement, 'text'>): TextElement {
  return {
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 400,
    height: 80,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 13,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#64748B',
    alignment: 'left',
    lineHeight: 1.45,
    backgroundColor: null,
    padding: 6,
    cornerRadius: 0,
    ...partial,
  };
}

describe('buildFeatureHtml', () => {
  it('renders caption body text even without a chrome label', () => {
    const caption = makeText({
      text: 'Small-angle approximation. Curve 1 damps; Curve 2 is driven.',
      componentType: 'caption',
      componentMeta: {
        placementMode: 'auto',
        associatedElementId: 'graph_1',
        role: 'graph_caption',
      },
    });
    expect(textElementNeedsHtmlOverlay(caption)).toBe(true);
    const html = buildFeatureHtml(caption);
    expect(html).toContain('text-feature-body');
    expect(html).toContain('Small-angle approximation');
    expect(html).not.toContain('text-component-label');
  });

  it('still renders labelled components with label + body', () => {
    const obs = makeText({
      text: 'Maximum speed at equilibrium.',
      componentType: 'key_observation',
      componentMeta: {
        placementMode: 'auto',
        associatedElementId: 'graph_1',
        role: 'graph_observation',
      },
    });
    const html = buildFeatureHtml(obs);
    expect(html).toContain('Key Observation');
    expect(html).toContain('Maximum speed at equilibrium.');
  });
});
