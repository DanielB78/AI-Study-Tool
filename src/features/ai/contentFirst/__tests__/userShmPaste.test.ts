import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { parseContentDocument } from '../contentParser';
import { handleContentFirstResponse } from '../applyContentFirst';
import { setAiGenerationModeOverride } from '../generationMode';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shmUserPaste.md'),
  'utf8',
);

function reset() {
  useCanvasStore.setState({
    document: createEmptyDocument(),
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
    activeTool: 'select',
    editingTextId: null,
    editingShapeLabelId: null,
    past: [],
    future: [],
    historySuspended: false,
    marquee: null,
    draftPoints: null,
    draftShape: null,
    clipboard: [],
    snapGuides: [],
  });
}

describe('user SHM ChatGPT paste', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
    setAiGenerationModeOverride('content_first');
  });
  afterEach(() => {
    setAiGenerationModeOverride(null);
    vi.restoreAllMocks();
  });

  it('parses without swallowing example steps into inline LaTeX', () => {
    const doc = parseContentDocument(fixture);
    for (const n of doc.nodes) {
      if (n.type === 'component' || n.type === 'paragraph') {
        for (const s of n.spans) {
          if (s.type === 'inline_math') {
            expect(s.latex).not.toMatch(/#|Step \d/);
          }
        }
      }
    }
    expect(doc.nodes.some((n) => n.type === 'component')).toBe(true);
    expect(doc.nodes.filter((n) => n.type === 'equation').length).toBeGreaterThan(
      10,
    );
    expect(doc.nodes.filter((n) => n.type === 'graph')).toHaveLength(2);
  });

  it('compiles and applies without rich_text LaTeX validation errors', () => {
    expect(() =>
      handleContentFirstResponse(fixture, { allowedElementIds: new Set() }),
    ).not.toThrow();
    const els = useCanvasStore.getState().document.elements;
    expect(els.some((e) => e.type === 'equation')).toBe(true);
    expect(els.some((e) => e.type === 'graph')).toBe(true);
    expect(
      els.some((e) => e.type === 'text' && e.componentType === 'example'),
    ).toBe(true);
  });
});
