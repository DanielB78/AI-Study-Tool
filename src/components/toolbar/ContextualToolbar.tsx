import {
  BringToFront,
  SendToBack,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import { TextOptions } from './TextOptions';
import { ShapeOptions } from './ShapeOptions';
import { StrokeOptions } from './StrokeOptions';

type ContextMode = 'text' | 'shape' | 'stroke' | null;

function resolveContextMode(
  activeTool: string,
  selectedTypes: string[],
): ContextMode {
  const hasText = selectedTypes.includes('text');
  const hasShape = selectedTypes.includes('shape');
  const hasStrokeObject =
    selectedTypes.includes('drawing') || selectedTypes.includes('connector');

  if (activeTool === 'text' || hasText) return 'text';
  if (activeTool === 'rectangle' || activeTool === 'ellipse' || hasShape) {
    return 'shape';
  }
  if (
    activeTool === 'pen' ||
    activeTool === 'line' ||
    activeTool === 'arrow' ||
    hasStrokeObject
  ) {
    return 'stroke';
  }
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

  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const selectedTypes = [...new Set(selected.map((el) => el.type))];
  const mode = resolveContextMode(activeTool, selectedTypes);
  const hasSelection = selected.length > 0;
  const showLayerControls = hasSelection;

  if (!mode && !showLayerControls) return null;

  const onStyleChange = (partial: Parameters<typeof setStyle>[0]) => {
    setStyle(partial);
    if (hasSelection) {
      queueMicrotask(() => applyStyleToSelection());
    }
  };

  const onEditText = () => {
    const text = selected.find((el) => el.type === 'text');
    if (!text) return;
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().setEditingTextId(text.id);
  };

  return (
    <div
      className="ctx-bar"
      role="toolbar"
      aria-label="Formatting options"
    >
      <div className="ctx-pill">
        {mode === 'text' && (
          <TextOptions
            style={style}
            onChange={onStyleChange}
            showEditButton={selected.some((el) => el.type === 'text')}
            onEditText={onEditText}
          />
        )}
        {mode === 'shape' && (
          <ShapeOptions style={style} onChange={onStyleChange} />
        )}
        {mode === 'stroke' && (
          <StrokeOptions style={style} onChange={onStyleChange} />
        )}

        {showLayerControls && (
          <>
            {mode && <div className="ctx-divider" aria-hidden />}
            <button
              type="button"
              className="ctx-icon-btn"
              title="Send to back"
              onClick={() => sendToBack()}
            >
              <SendToBack size={16} strokeWidth={1.85} />
            </button>
            <button
              type="button"
              className="ctx-icon-btn"
              title="Send backward"
              onClick={() => sendBackward()}
            >
              <ArrowDownToLine size={16} strokeWidth={1.85} />
            </button>
            <button
              type="button"
              className="ctx-icon-btn"
              title="Bring forward"
              onClick={() => bringForward()}
            >
              <ArrowUpToLine size={16} strokeWidth={1.85} />
            </button>
            <button
              type="button"
              className="ctx-icon-btn"
              title="Bring to front"
              onClick={() => bringToFront()}
            >
              <BringToFront size={16} strokeWidth={1.85} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
