import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowUpRight,
  Hand,
  Image as ImageIcon,
  MousePointer2,
  Pencil,
  Redo2,
  Shapes,
  Type,
  Undo2,
  Minus,
} from 'lucide-react';
import type { ShapeType, ToolType } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import { ToolButton } from './ToolButton';
import { ShapesPopover } from './ShapesPopover';

const HIDE_DELAY_MS = 280;
const EDGE_ZONE_PX = 18;

function isShapeTool(tool: ToolType): tool is 'rectangle' | 'ellipse' {
  return tool === 'rectangle' || tool === 'ellipse';
}

interface FloatingToolPaletteProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function FloatingToolPalette({ fileInputRef }: FloatingToolPaletteProps) {
  const hideTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shapesOpenRef = useRef(false);
  const prevToolRef = useRef<ToolType | null>(null);

  const [revealed, setRevealed] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);

  const activeTool = useCanvasStore((s) => s.activeTool);
  const past = useCanvasStore((s) => s.past);
  const future = useCanvasStore((s) => s.future);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const addImageFromFile = useCanvasStore((s) => s.addImageFromFile);

  const visible = revealed || shapesOpen;

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      if (shapesOpenRef.current) return;
      setRevealed(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const reveal = useCallback(() => {
    clearHideTimer();
    setRevealed(true);
  }, [clearHideTimer]);

  const closeShapes = useCallback(() => setShapesOpen(false), []);

  useEffect(() => {
    shapesOpenRef.current = shapesOpen;
  }, [shapesOpen]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!shapesOpenRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      closeShapes();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeShapes]);

  useEffect(() => {
    if (!shapesOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      closeShapes();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [shapesOpen, closeShapes]);

  useEffect(() => {
    const prev = prevToolRef.current;
    prevToolRef.current = activeTool;
    if (prev === null || !shapesOpenRef.current || prev === activeTool) return;
    if (!isShapeTool(activeTool)) closeShapes();
  }, [activeTool, closeShapes]);

  const pickShape = (shape: ShapeType) => {
    setTool(shape);
    closeShapes();
  };

  const shapesActive = isShapeTool(activeTool);

  return (
    <>
      <div
        className="ftb-edge-zone"
        style={{ width: EDGE_ZONE_PX }}
        onPointerEnter={reveal}
        onPointerLeave={scheduleHide}
        aria-hidden
      />

      <div
        ref={rootRef}
        className={visible ? 'ftb-root visible' : 'ftb-root'}
        onPointerEnter={reveal}
        onPointerLeave={scheduleHide}
      >
        <div className="ftb-pill" role="toolbar" aria-label="Canvas tools">
          <ToolButton
            label="Select"
            shortcut="V"
            icon={MousePointer2}
            active={activeTool === 'select'}
            onClick={() => {
              closeShapes();
              setTool('select');
            }}
          />
          <ToolButton
            label="Pan"
            shortcut="H"
            icon={Hand}
            active={activeTool === 'pan'}
            onClick={() => {
              closeShapes();
              setTool('pan');
            }}
          />
          <ToolButton
            label="Text"
            shortcut="T"
            icon={Type}
            active={activeTool === 'text'}
            onClick={() => {
              closeShapes();
              setTool('text');
            }}
          />
          <ToolButton
            label="Pen"
            shortcut="P"
            icon={Pencil}
            active={activeTool === 'pen'}
            onClick={() => {
              closeShapes();
              setTool('pen');
            }}
          />
          <ToolButton
            label="Shapes"
            shortcut="R"
            icon={Shapes}
            active={shapesActive || shapesOpen}
            aria-expanded={shapesOpen}
            aria-haspopup="menu"
            onClick={() => setShapesOpen((open) => !open)}
          />
          <ToolButton
            label="Line"
            shortcut="L"
            icon={Minus}
            active={activeTool === 'line'}
            onClick={() => {
              closeShapes();
              setTool('line');
            }}
          />
          <ToolButton
            label="Arrow"
            shortcut="A"
            icon={ArrowUpRight}
            active={activeTool === 'arrow'}
            onClick={() => {
              closeShapes();
              setTool('arrow');
            }}
          />
          <ToolButton
            label="Image"
            shortcut="I"
            icon={ImageIcon}
            onClick={() => {
              closeShapes();
              fileInputRef.current?.click();
            }}
          />

          <div className="ftb-divider" aria-hidden />

          <ToolButton
            label="Undo"
            shortcut="Ctrl+Z"
            icon={Undo2}
            disabled={past.length === 0}
            onClick={() => undo()}
          />
          <ToolButton
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            icon={Redo2}
            disabled={future.length === 0}
            onClick={() => redo()}
          />
        </div>

        {shapesOpen && (
          <ShapesPopover
            activeShape={shapesActive ? activeTool : null}
            onSelect={pickShape}
          />
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
    </>
  );
}
