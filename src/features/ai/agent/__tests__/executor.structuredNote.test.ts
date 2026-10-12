import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE, type TextElement } from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { createConceptSummaryStructure } from '../../../structures/factory';
import { useStructureStore } from '../../../structures/structureStore';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';

const structure = createConceptSummaryStructure();

function resetCanvas() {
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: [
        {
          id: 'textbox_18',
          type: 'text',
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
          text: 'Anchor note',
          fontSize: 16,
          fontFamily: 'sans',
          fontWeight: 'normal',
          fontItalic: false,
          underline: false,
          strikethrough: false,
          color: '#000',
          alignment: 'left',
          lineHeight: 1.3,
          backgroundColor: '#fff',
          padding: 12,
          cornerRadius: 8,
        } satisfies TextElement,
      ],
    },
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

describe('execute create_structured_note', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates four elements in saved layout as one undo transaction', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_structured_note',
          structure_id: structure.id,
          fields: {
            title: { content: "Gauss's Law" },
            explanation: { content: 'Flux through a closed surface equals enclosed charge over ε₀.' },
            equation: {
              latex:
                '\\oint_S \\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\mathrm{enc}}}{\\varepsilon_0}',
            },
            example: { content: 'Spherical symmetry simplifies the surface integral.' },
          },
          placement: { mode: 'viewport_default' },
        },
      ],
      createLiveAgentExecutorTarget(),
    );

    expect(result.createdIds).toHaveLength(4);
    expect(result.structureInstanceIds).toHaveLength(1);
    const els = useCanvasStore.getState().document.elements.filter((e) =>
      result.createdIds.includes(e.id),
    );
    expect(els).toHaveLength(4);
    const instanceId = result.structureInstanceIds[0];
    for (const el of els) {
      expect(el.metadata?.structureId).toBe(structure.id);
      expect(el.metadata?.structureInstanceId).toBe(instanceId);
    }
    const eq = els.find((e) => e.type === 'equation');
    expect(eq).toBeTruthy();
    expect(ragSync.indexText).toHaveBeenCalled();

    // One undo removes the whole structure instance.
    useCanvasStore.getState().undo();
    const afterUndo = useCanvasStore.getState().document.elements;
    expect(afterUndo.some((e) => result.createdIds.includes(e.id))).toBe(false);

    useCanvasStore.getState().redo();
    const afterRedo = useCanvasStore.getState().document.elements;
    expect(result.createdIds.every((id) => afterRedo.some((e) => e.id === id))).toBe(
      true,
    );
  });

  it('omits optional empty fields and keeps remaining geometry', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_structured_note',
          structure_id: structure.id,
          fields: {
            title: { content: 'No equation topic' },
            explanation: { content: 'Some concepts have no useful equation.' },
          },
          placement: { mode: 'viewport_default' },
        },
      ],
      createLiveAgentExecutorTarget(),
    );
    expect(result.createdIds).toHaveLength(2);
    const els = useCanvasStore.getState().document.elements.filter((e) =>
      result.createdIds.includes(e.id),
    );
    expect(els.every((e) => e.type === 'text')).toBe(true);
  });

  it('places whole structure relative_to_element while preserving internal geometry', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_structured_note',
          structure_id: structure.id,
          fields: {
            title: { content: 'Title' },
            explanation: { content: 'Body' },
          },
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_18',
            relation: 'right_of',
          },
        },
      ],
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore
      .getState()
      .document.elements.filter((e) => result.createdIds.includes(e.id));
    const title = els.find((e) => e.metadata?.structureFieldId === 'title')!;
    const explanation = els.find(
      (e) => e.metadata?.structureFieldId === 'explanation',
    )!;
    const titleField = structure.fields.find((f) => f.id === 'title')!;
    const explField = structure.fields.find((f) => f.id === 'explanation')!;
    expect(explanation.x - title.x).toBe(explField.relativeX - titleField.relativeX);
    expect(explanation.y - title.y).toBe(explField.relativeY - titleField.relativeY);
    expect(title.x).toBeGreaterThan(100 + 200); // right of anchor
  });
});
