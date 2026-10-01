import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { createKnowledgeTreeStructure } from '../../../structures/factory';
import { useStructureStore } from '../../../structures/structureStore';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';

const structure = createKnowledgeTreeStructure();
const sectionId = structure.fields[0]!.id;

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
  useStructureStore.setState({
    structures: [structure],
    uiMode: 'closed',
    draft: null,
    selectedFieldId: null,
    selectedStructureIdForAi: structure.id,
  });
}

describe('execute NODE_SECTION structured notes', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates text nodes + bound connectors in one undo transaction', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_structured_note',
          structure_id: structure.id,
          fields: {
            [sectionId]: {
              root: {
                content: 'Electromagnetism',
                children: [
                  {
                    content: 'Electrostatics',
                    children: [
                      { content: "Gauss's Law", children: [] },
                      { content: "Coulomb's Law", children: [] },
                    ],
                  },
                  {
                    content: 'Induction',
                    children: [{ content: "Faraday's Law", children: [] }],
                  },
                ],
              },
            },
          },
          placement: { mode: 'viewport_default' },
        },
      ],
      createLiveAgentExecutorTarget(),
    );

    // 6 nodes + 5 connectors
    expect(result.createdIds).toHaveLength(11);
    const els = useCanvasStore.getState().document.elements;
    const texts = els.filter((e) => e.type === 'text');
    const connectors = els.filter((e) => e.type === 'connector');
    expect(texts).toHaveLength(6);
    expect(connectors).toHaveLength(5);

    for (const c of connectors) {
      if (c.type !== 'connector') continue;
      expect(c.startBindingId).toBeTruthy();
      expect(c.endBindingId).toBeTruthy();
      expect(c.metadata?.relationshipType).toBe('parent_child');
      expect(texts.some((t) => t.id === c.startBindingId)).toBe(true);
      expect(texts.some((t) => t.id === c.endBindingId)).toBe(true);
    }

    const root = texts.find((t) => t.metadata?.depth === 0);
    expect(root?.metadata?.parentNodeElementId).toBeNull();
    expect(root?.metadata?.nodeSectionId).toBe(sectionId);
    expect(ragSync.indexText).toHaveBeenCalled();

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(11);
  });
});
