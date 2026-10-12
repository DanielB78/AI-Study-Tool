import { useCanvasStore } from '../../store/canvasStore';
import { isShapeTool } from '../../types/canvas';
import { ArrangePopover } from './ArrangePopover';
import {
  TextFormattingControls,
  ShapeFormattingControls,
  StrokeFormattingControls,
} from './FormattingControls';
import { OpacityControl } from './CtxPopover';
import { TextFeaturesMenu } from './TextFeaturesMenu';
import { useGraphUiStore } from '../../features/graphs/graphUiStore';
import { DEFAULT_GRAPH_VIEWPORT } from '../../features/graphs/types';
import { touch } from '../../utils/ids';
import type { TextElement } from '../../types/canvas';

type ContextMode = 'text' | 'shape' | 'stroke' | 'image' | 'graph' | 'multi' | null;

function resolveMode(
  activeTool: string,
  selectedTypes: string[],
  count: number,
): ContextMode {
  if (count > 1) return 'multi';
  if (activeTool === 'text' || selectedTypes.includes('text')) return 'text';
  if (isShapeTool(activeTool as never) || selectedTypes.includes('shape')) {
    return 'shape';
  }
  if (
    activeTool === 'pen' ||
    activeTool === 'line' ||
    activeTool === 'arrow' ||
    selectedTypes.includes('drawing') ||
    selectedTypes.includes('connector')
  ) {
    return 'stroke';
  }
  if (selectedTypes.includes('image')) return 'image';
  if (activeTool === 'graph' || selectedTypes.includes('graph')) return 'graph';
  return null;
}

export function ContextualToolbar() {
  const activeTool = useCanvasStore((s) => s.activeTool);
  const style = useCanvasStore((s) => s.style);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const elements = useCanvasStore((s) => s.document.elements);
  const setStyle = useCanvasStore((s) => s.setStyle);
  const applyStyleToSelection = useCanvasStore((s) => s.applyStyleToSelection);
  const bringForward = useCanvasStore((s) => s.bringForward);
  const sendBackward = useCanvasStore((s) => s.sendBackward);
  const bringToFront = useCanvasStore((s) => s.bringToFront);
  const sendToBack = useCanvasStore((s) => s.sendToBack);
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected);
  const toggleLockSelected = useCanvasStore((s) => s.toggleLockSelected);
  const alignSelected = useCanvasStore((s) => s.alignSelected);

  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const selectedTypes = [...new Set(selected.map((el) => el.type))];
  const mode = resolveMode(activeTool, selectedTypes, selected.length);
  const hasSelection = selected.length > 0;
  const anyLocked = selected.some((el) => el.locked);
  const showCorner =
    activeTool === 'roundedRect' ||
    selected.some((el) => el.type === 'shape' && el.shapeType === 'roundedRect');
  const showArrowHeads =
    activeTool === 'arrow' ||
    selected.some((el) => el.type === 'connector' && el.connectorType === 'arrow');

  // Hooks must run unconditionally — create_text / apply selects content and
  // would otherwise add these after an early return (Rules of Hooks crash).
  const openGraphEditor = useGraphUiStore((s) => s.openEditor);
  const enterInteract = useGraphUiStore((s) => s.enterInteract);
  const interactingGraphId = useGraphUiStore((s) => s.interactingGraphId);
  const exitInteract = useGraphUiStore((s) => s.exitInteract);

  if (!mode && !hasSelection) return null;

  const onLive = (partial: Parameters<typeof setStyle>[0]) => {
    setStyle(partial);
    // Live preview on selection without history spam
    if (hasSelection) {
      const idSet = new Set(selectedIds);
      useCanvasStore.setState((s) => ({
        document: {
          ...s.document,
          elements: s.document.elements.map((el) => {
            if (!idSet.has(el.id) || el.locked) return el;
            // lightweight live opacity/stroke width preview via apply path is heavy;
            // rely on style store + applyStyleToSelection on commit for most fields.
            return el;
          }),
        },
      }));
      // Immediately apply non-history live visual for opacity/stroke via updateElements without history
      useCanvasStore.getState().updateElements([...idSet], (el) => {
        if (el.locked) return el;
        if (partial.opacity !== undefined) return { ...el, opacity: partial.opacity };
        if (partial.strokeWidth !== undefined) {
          if (el.type === 'shape' || el.type === 'connector') {
            return { ...el, strokeWidth: partial.strokeWidth };
          }
          if (el.type === 'drawing') return { ...el, strokeWidth: partial.strokeWidth };
        }
        if (partial.cornerRadius !== undefined && el.type === 'shape') {
          return { ...el, cornerRadius: partial.cornerRadius };
        }
        if (partial.lineHeight !== undefined && el.type === 'text') {
          return { ...el, lineHeight: partial.lineHeight };
        }
        if (partial.textPadding !== undefined && el.type === 'text') {
          return { ...el, padding: partial.textPadding };
        }
        if (partial.textCornerRadius !== undefined && el.type === 'text') {
          return { ...el, cornerRadius: partial.textCornerRadius };
        }
        return el;
      });
    }
  };

  const onCommit = (partial: Parameters<typeof setStyle>[0]) => {
    setStyle(partial);
    if (hasSelection) applyStyleToSelection(partial);
  };

  const onEditText = () => {
    const text = selected.find((el) => el.type === 'text');
    if (!text || text.locked) return;
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().setEditingTextId(text.id);
  };

  const graph = selected.find((el) => el.type === 'graph');

  const resetGraphView = () => {
    if (!graph || graph.type !== 'graph') return;
    const store = useCanvasStore.getState();
    store.pushHistory();
    store.updateElement(graph.id, (el) =>
      el.type === 'graph'
        ? touch({ ...el, viewport: { ...DEFAULT_GRAPH_VIEWPORT } })
        : el,
    );
    store.persist();
  };

  return (
    <div className="ctx-bar" role="toolbar" aria-label="Formatting options">
      <div className="ctx-pill">
        {mode === 'text' && (
          <>
            <TextFormattingControls
              style={style}
              onLive={onLive}
              onCommit={onCommit}
              showEdit={selected.some((el) => el.type === 'text')}
              onEdit={onEditText}
            />
            {selected.length === 1 &&
              selected[0]?.type === 'text' &&
              !selected[0].locked && (
                <TextFeaturesMenu element={selected[0] as TextElement} />
              )}
          </>
        )}
        {mode === 'shape' && (
          <ShapeFormattingControls
            style={style}
            onLive={onLive}
            onCommit={onCommit}
            showCornerRadius={showCorner}
          />
        )}
        {mode === 'stroke' && (
          <StrokeFormattingControls
            style={style}
            onLive={onLive}
            onCommit={onCommit}
            showArrowHeads={showArrowHeads}
          />
        )}
        {mode === 'image' && (
          <OpacityControl
            value={style.opacity}
            onChange={(v) => onLive({ opacity: v })}
            onCommit={(v) => onCommit({ opacity: v })}
          />
        )}
        {mode === 'graph' && graph && (
          <>
            <button
              type="button"
              className="ctx-chip"
              onClick={() => openGraphEditor(graph.id)}
            >
              Edit Graph
            </button>
            <button
              type="button"
              className="ctx-chip"
              onClick={() => {
                if (interactingGraphId === graph.id) exitInteract();
                else enterInteract(graph.id);
              }}
            >
              {interactingGraphId === graph.id ? 'Exit Interact' : 'Interact'}
            </button>
            <button type="button" className="ctx-chip" onClick={resetGraphView}>
              Reset View
            </button>
            <OpacityControl
              value={style.opacity}
              onChange={(v) => onLive({ opacity: v })}
              onCommit={(v) => onCommit({ opacity: v })}
            />
          </>
        )}
        {mode === 'multi' && (
          <OpacityControl
            value={style.opacity}
            onChange={(v) => onLive({ opacity: v })}
            onCommit={(v) => onCommit({ opacity: v })}
          />
        )}

        {hasSelection && (
          <>
            {(mode === 'text' ||
              mode === 'shape' ||
              mode === 'stroke' ||
              mode === 'image' ||
              mode === 'graph' ||
              mode === 'multi') && <div className="ctx-divider" aria-hidden />}
            <ArrangePopover
              count={selected.length}
              locked={anyLocked}
              onAlign={alignSelected}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onBringToFront={bringToFront}
              onSendToBack={sendToBack}
              onDuplicate={duplicateSelected}
              onToggleLock={toggleLockSelected}
            />
          </>
        )}
      </div>
    </div>
  );
}
