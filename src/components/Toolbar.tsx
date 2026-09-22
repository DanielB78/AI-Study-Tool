import { useRef } from 'react';
import type { ToolType } from '../types/canvas';
import { useCanvasStore } from '../store/canvasStore';
import { useKeyboardShortcuts } from '../canvas/hooks/useKeyboardShortcuts';

interface ToolDef {
  id: ToolType | 'image';
  label: string;
  shortcut?: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'pan', label: 'Pan', shortcut: 'H' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'rectangle', label: 'Rect', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A' },
  { id: 'image', label: 'Image', shortcut: 'I' },
];

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcuts(fileInputRef);

  const activeTool = useCanvasStore((s) => s.activeTool);
  const style = useCanvasStore((s) => s.style);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const elements = useCanvasStore((s) => s.document.elements);
  const setTool = useCanvasStore((s) => s.setTool);
  const setStyle = useCanvasStore((s) => s.setStyle);
  const applyStyleToSelection = useCanvasStore((s) => s.applyStyleToSelection);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const bringForward = useCanvasStore((s) => s.bringForward);
  const sendBackward = useCanvasStore((s) => s.sendBackward);
  const bringToFront = useCanvasStore((s) => s.bringToFront);
  const sendToBack = useCanvasStore((s) => s.sendToBack);
  const addImageFromFile = useCanvasStore((s) => s.addImageFromFile);
  const past = useCanvasStore((s) => s.past);
  const future = useCanvasStore((s) => s.future);

  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const hasSelection = selected.length > 0;
  const showTextControls =
    activeTool === 'text' || selected.some((el) => el.type === 'text');
  const showFill =
    activeTool === 'rectangle' ||
    activeTool === 'ellipse' ||
    selected.some((el) => el.type === 'shape');
  const showStroke =
    activeTool === 'pen' ||
    activeTool === 'rectangle' ||
    activeTool === 'ellipse' ||
    activeTool === 'line' ||
    activeTool === 'arrow' ||
    selected.some(
      (el) =>
        el.type === 'shape' || el.type === 'drawing' || el.type === 'connector',
    );

  const onToolClick = (id: ToolDef['id']) => {
    if (id === 'image') {
      fileInputRef.current?.click();
      return;
    }
    setTool(id);
  };

  const onStyleChange = (partial: Parameters<typeof setStyle>[0]) => {
    setStyle(partial);
    if (hasSelection) {
      // Defer so style state is updated first
      queueMicrotask(() => applyStyleToSelection());
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <span className="brand-mark">StudyBoard</span>
      </div>

      <div className="toolbar-group" role="toolbar" aria-label="Tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={
              activeTool === tool.id || (tool.id === 'image' && activeTool === 'image')
                ? 'tool-btn active'
                : 'tool-btn'
            }
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            aria-pressed={activeTool === tool.id}
            onClick={() => onToolClick(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          title="Undo (Ctrl+Z)"
          disabled={past.length === 0}
          onClick={() => undo()}
        >
          Undo
        </button>
        <button
          type="button"
          className="tool-btn"
          title="Redo (Ctrl+Shift+Z)"
          disabled={future.length === 0}
          onClick={() => redo()}
        >
          Redo
        </button>
      </div>

      <div className="toolbar-group contextual">
        {showStroke && (
          <>
            <label className="style-field">
              <span>Stroke</span>
              <input
                type="color"
                value={style.strokeColor}
                onChange={(e) => onStyleChange({ strokeColor: e.target.value })}
              />
            </label>
            <label className="style-field">
              <span>Width</span>
              <input
                type="range"
                min={1}
                max={24}
                value={style.strokeWidth}
                onChange={(e) =>
                  onStyleChange({ strokeWidth: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}

        {showFill && (
          <label className="style-field">
            <span>Fill</span>
            <input
              type="color"
              value={style.fillColor}
              onChange={(e) => onStyleChange({ fillColor: e.target.value })}
            />
          </label>
        )}

        {showTextControls && (
          <>
            <label className="style-field">
              <span>Text</span>
              <input
                type="color"
                value={style.textColor}
                onChange={(e) => onStyleChange({ textColor: e.target.value })}
              />
            </label>
            <label className="style-field">
              <span>Size</span>
              <input
                type="number"
                min={10}
                max={96}
                value={style.fontSize}
                onChange={(e) =>
                  onStyleChange({ fontSize: Number(e.target.value) || 18 })
                }
              />
            </label>
            <button
              type="button"
              className={style.fontBold ? 'tool-btn active' : 'tool-btn'}
              onClick={() => onStyleChange({ fontBold: !style.fontBold })}
            >
              Bold
            </button>
            <select
              className="align-select"
              value={style.textAlignment}
              onChange={(e) =>
                onStyleChange({
                  textAlignment: e.target.value as 'left' | 'center' | 'right',
                })
              }
              aria-label="Text alignment"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </>
        )}

        {hasSelection && (
          <div className="layer-controls">
            <button type="button" className="tool-btn" onClick={() => sendToBack()} title="Send to back">
              ⟸
            </button>
            <button type="button" className="tool-btn" onClick={() => sendBackward()} title="Send backward">
              ←
            </button>
            <button type="button" className="tool-btn" onClick={() => bringForward()} title="Bring forward">
              →
            </button>
            <button type="button" className="tool-btn" onClick={() => bringToFront()} title="Bring to front">
              ⟹
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const cam = useCanvasStore.getState().document.camera;
          const worldX = (window.innerWidth / 2 - cam.x) / cam.zoom;
          const worldY = (window.innerHeight / 2 - cam.y) / cam.zoom;
          await addImageFromFile(file, worldX, worldY);
        }}
      />
    </header>
  );
}
