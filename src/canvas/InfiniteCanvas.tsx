import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Stage, Layer, Rect, Line } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore, type DraftShapeKind } from '../store/canvasStore';
import { ElementRenderer } from './elements/ElementRenderer';
import { SelectionTransformer } from './elements/SelectionTransformer';
import { TextEditorOverlay } from './TextEditorOverlay';
import { DraftShapePreview } from './DraftShapePreview';
import {
  normalizeRect,
  rectsIntersect,
  screenToWorld,
  zoomAtPoint,
} from '../utils/coordinates';
import { snapPosition } from '../utils/snap';
import { ZOOM_STEP, isShapeTool } from '../types/canvas';

function getCursor(
  tool: string,
  isSpacePanning: boolean,
  isPanning: boolean,
): string {
  if (isSpacePanning || tool === 'pan' || isPanning) {
    return isPanning ? 'grabbing' : 'grab';
  }
  if (tool === 'text') return 'text';
  if (
    tool === 'pen' ||
    tool === 'line' ||
    tool === 'arrow' ||
    isShapeTool(tool as never)
  ) {
    return 'crosshair';
  }
  return 'default';
}

export function InfiniteCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const panState = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  } | null>(null);
  const drawState = useRef<{ drawing: boolean; points: number[] } | null>(null);
  const shapeState = useRef<{
    startX: number;
    startY: number;
    kind: DraftShapeKind;
  } | null>(null);
  const pendingTextCreate = useRef<{ x: number; y: number } | null>(null);
  const pendingTextEdit = useRef<string | null>(null);
  const marqueeState = useRef<{
    startX: number;
    startY: number;
    additive: boolean;
  } | null>(null);
  const multiDrag = useRef<{
    primaryId: string;
    origin: Map<string, { x: number; y: number }>;
    startX: number;
    startY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const document = useCanvasStore((s) => s.document);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const editingTextId = useCanvasStore((s) => s.editingTextId);
  const editingShapeLabelId = useCanvasStore((s) => s.editingShapeLabelId);
  const isSpacePanning = useCanvasStore((s) => s.isSpacePanning);
  const marquee = useCanvasStore((s) => s.marquee);
  const draftPoints = useCanvasStore((s) => s.draftPoints);
  const draftShape = useCanvasStore((s) => s.draftShape);
  const snapGuides = useCanvasStore((s) => s.snapGuides);
  const style = useCanvasStore((s) => s.style);

  const setCamera = useCanvasStore((s) => s.setCamera);
  const select = useCanvasStore((s) => s.select);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const setEditingTextId = useCanvasStore((s) => s.setEditingTextId);
  const setEditingShapeLabelId = useCanvasStore((s) => s.setEditingShapeLabelId);
  const setMarquee = useCanvasStore((s) => s.setMarquee);
  const setDraftPoints = useCanvasStore((s) => s.setDraftPoints);
  const setDraftShape = useCanvasStore((s) => s.setDraftShape);
  const setSnapGuides = useCanvasStore((s) => s.setSnapGuides);
  const beginInteraction = useCanvasStore((s) => s.beginInteraction);
  const endInteraction = useCanvasStore((s) => s.endInteraction);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const updateElements = useCanvasStore((s) => s.updateElements);
  const createTextAt = useCanvasStore((s) => s.createTextAt);
  const commitDrawing = useCanvasStore((s) => s.commitDrawing);
  const commitShape = useCanvasStore((s) => s.commitShape);
  const addImageFromFile = useCanvasStore((s) => s.addImageFromFile);
  const persist = useCanvasStore((s) => s.persist);
  const pushHistory = useCanvasStore((s) => s.pushHistory);

  const camera = document.camera;
  const elements = document.elements;

  const isSelectMode = activeTool === 'select' && !isSpacePanning;
  const canInteractWithObjects = isSelectMode;

  const getWorldPointer = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const layer = stage.findOne('Layer');
    if (layer) {
      const rel = layer.getRelativePointerPosition();
      if (rel) return { x: rel.x, y: rel.y };
    }
    return screenToWorld(pointer, useCanvasStore.getState().document.camera);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
      setContainerRect(rect);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const cam = useCanvasStore.getState().document.camera;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const intensity = Math.min(Math.abs(e.evt.deltaY) / 100, 2.5);
      const factor = Math.pow(ZOOM_STEP, direction * Math.max(intensity, 0.35));
      setCamera(zoomAtPoint(cam, pointer, cam.zoom * factor));
      persist();
    },
    [setCamera, persist],
  );

  const startPan = (x: number, y: number) => {
    panState.current = { active: true, lastX: x, lastY: y };
    setIsPanning(true);
  };

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const tool = useCanvasStore.getState().activeTool;
    const spacePan = useCanvasStore.getState().isSpacePanning;
    const world = getWorldPointer();
    if (!world) return;
    const clickedEmpty = e.target === stage || e.target.name() === 'board-bg';

    if (spacePan || tool === 'pan' || e.evt.button === 1) {
      e.evt.preventDefault();
      startPan(pointer.x, pointer.y);
      return;
    }

    if (tool === 'pen') {
      drawState.current = { drawing: true, points: [world.x, world.y] };
      setDraftPoints([world.x, world.y]);
      clearSelection();
      return;
    }

    if (isShapeTool(tool) || tool === 'line' || tool === 'arrow') {
      shapeState.current = { startX: world.x, startY: world.y, kind: tool };
      setDraftShape({
        kind: tool,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        x2: world.x,
        y2: world.y,
      });
      clearSelection();
      return;
    }

    if (tool === 'text') {
      // Prefer document hit-testing so we edit existing text even if Konva misses.
      const hitText = [...useCanvasStore.getState().document.elements]
        .reverse()
        .find((el) => {
          if (el.type !== 'text') return false;
          const pad = 12;
          return (
            world.x >= el.x - pad &&
            world.x <= el.x + Math.max(el.width, 24) + pad &&
            world.y >= el.y - pad &&
            world.y <= el.y + Math.max(el.height, el.fontSize * 1.4) + pad
          );
        });
      if (hitText) {
        pendingTextEdit.current = hitText.id;
        pendingTextCreate.current = null;
        return;
      }
      pendingTextEdit.current = null;
      pendingTextCreate.current = { x: world.x, y: world.y };
      return;
    }

    if (tool === 'select' && clickedEmpty) {
      marqueeState.current = {
        startX: world.x,
        startY: world.y,
        additive: e.evt.shiftKey,
      };
      setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
      if (!e.evt.shiftKey) clearSelection();
    }
  };

  const onPointerMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const cam = useCanvasStore.getState().document.camera;
    const world = getWorldPointer();
    if (!world) return;

    if (panState.current?.active) {
      const dx = pointer.x - panState.current.lastX;
      const dy = pointer.y - panState.current.lastY;
      panState.current.lastX = pointer.x;
      panState.current.lastY = pointer.y;
      setCamera({
        ...cam,
        x: cam.x + dx,
        y: cam.y + dy,
      });
      return;
    }

    if (drawState.current?.drawing) {
      const pts = drawState.current.points;
      const lastX = pts[pts.length - 2]!;
      const lastY = pts[pts.length - 1]!;
      if (Math.hypot(world.x - lastX, world.y - lastY) < 1.5 / cam.zoom) return;
      const next = [...pts, world.x, world.y];
      drawState.current.points = next;
      setDraftPoints(next);
      return;
    }

    if (shapeState.current) {
      const { startX, startY, kind } = shapeState.current;
      if (kind === 'line' || kind === 'arrow') {
        setDraftShape({
          kind,
          x: startX,
          y: startY,
          width: world.x - startX,
          height: world.y - startY,
          x2: world.x,
          y2: world.y,
        });
      } else {
        const rect = normalizeRect(startX, startY, world.x, world.y);
        setDraftShape({ kind, ...rect, x2: world.x, y2: world.y });
      }
      return;
    }

    if (marqueeState.current) {
      const { startX, startY } = marqueeState.current;
      setMarquee(normalizeRect(startX, startY, world.x, world.y));
    }
  };

  const onPointerUp = () => {
    if (panState.current?.active) {
      panState.current = null;
      setIsPanning(false);
      persist();
    }

    if (pendingTextEdit.current) {
      const id = pendingTextEdit.current;
      pendingTextEdit.current = null;
      pendingTextCreate.current = null;
      window.setTimeout(() => {
        select([id]);
        pushHistory();
        setEditingTextId(id);
      }, 0);
      return;
    }

    if (pendingTextCreate.current) {
      const { x, y } = pendingTextCreate.current;
      pendingTextCreate.current = null;
      // Defer so the creating pointerup cannot immediately blur the overlay.
      window.setTimeout(() => createTextAt(x, y), 0);
      return;
    }

    if (drawState.current?.drawing) {
      const points = drawState.current.points;
      drawState.current = null;
      commitDrawing(points);
    }

    if (shapeState.current) {
      const draft = useCanvasStore.getState().draftShape;
      shapeState.current = null;
      if (draft) commitShape(draft);
      else setDraftShape(null);
    }

    if (marqueeState.current) {
      const box = useCanvasStore.getState().marquee;
      const additive = marqueeState.current.additive;
      marqueeState.current = null;
      setMarquee(null);
      if (box && (box.width > 2 || box.height > 2)) {
        const hits = useCanvasStore
          .getState()
          .document.elements.filter((el) =>
            rectsIntersect(box, {
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
            }),
          )
          .map((el) => el.id);
        if (additive) {
          const current = useCanvasStore.getState().selectedIds;
          select([...new Set([...current, ...hits])]);
        } else {
          select(hits);
        }
      }
    }
  };

  const onSelectElement = useCallback(
    (id: string, additive: boolean) => {
      if (!canInteractWithObjects) return;
      const current = useCanvasStore.getState().selectedIds;
      if (!additive && current.includes(id) && current.length > 1) {
        return;
      }
      select([id], additive);
    },
    [canInteractWithObjects, select],
  );

  const onDragStartElement = useCallback(
    (id: string) => {
      const state = useCanvasStore.getState();
      const target = state.document.elements.find((el) => el.id === id);
      if (target?.locked) return;
      beginInteraction();
      let ids = state.selectedIds;
      if (!ids.includes(id)) {
        ids = [id];
        select([id]);
      }
      const origin = new Map<string, { x: number; y: number }>();
      for (const el of state.document.elements) {
        if (ids.includes(el.id) && !el.locked) {
          origin.set(el.id, { x: el.x, y: el.y });
        }
      }
      const primary = state.document.elements.find((el) => el.id === id);
      multiDrag.current = {
        primaryId: id,
        origin,
        startX: primary?.x ?? 0,
        startY: primary?.y ?? 0,
      };
    },
    [beginInteraction, select],
  );

  const onDragMoveElement = useCallback(
    (id: string, x: number, y: number) => {
      const drag = multiDrag.current;
      if (!drag || drag.primaryId !== id) return;
      const primary = useCanvasStore
        .getState()
        .document.elements.find((el) => el.id === id);
      if (!primary) return;
      const others = useCanvasStore
        .getState()
        .document.elements.filter((el) => !drag.origin.has(el.id));
      const snapped = snapPosition(
        { x, y, width: primary.width, height: primary.height },
        others,
      );
      setSnapGuides(snapped.guides);
      const dx = snapped.x - drag.startX;
      const dy = snapped.y - drag.startY;
      const ids = [...drag.origin.keys()].filter((sid) => sid !== id);
      if (ids.length === 0) return;
      updateElements(ids, (el) => {
        const o = drag.origin.get(el.id);
        if (!o) return el;
        return { ...el, x: o.x + dx, y: o.y + dy };
      });
    },
    [updateElements, setSnapGuides],
  );

  const onDragEndElement = useCallback(
    (id: string, x: number, y: number) => {
      const drag = multiDrag.current;
      if (drag && drag.primaryId === id) {
        const primary = useCanvasStore
          .getState()
          .document.elements.find((el) => el.id === id);
        const others = useCanvasStore
          .getState()
          .document.elements.filter((el) => !drag.origin.has(el.id));
        const snapped = primary
          ? snapPosition(
              { x, y, width: primary.width, height: primary.height },
              others,
            )
          : { x, y, guides: [] };
        const dx = snapped.x - drag.startX;
        const dy = snapped.y - drag.startY;
        const ids = [...drag.origin.keys()];
        updateElements(ids, (el) => {
          const o = drag.origin.get(el.id);
          if (!o) return el;
          return { ...el, x: o.x + dx, y: o.y + dy };
        });
      } else {
        updateElement(id, (el) => ({ ...el, x, y }));
      }
      multiDrag.current = null;
      setSnapGuides([]);
      endInteraction();
    },
    [updateElement, updateElements, endInteraction, setSnapGuides],
  );

  const onEditText = useCallback(
    (id: string) => {
      const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
      if (el?.locked) return;
      select([id]);
      pushHistory();
      setEditingTextId(id);
    },
    [select, setEditingTextId, pushHistory],
  );

  const onEditShapeLabel = useCallback(
    (id: string) => {
      const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
      if (!el || el.type !== 'shape' || el.locked) return;
      select([id]);
      pushHistory();
      setEditingShapeLabelId(id);
    },
    [select, setEditingShapeLabelId, pushHistory],
  );

  const editingTarget = useMemo(() => {
    if (editingTextId) {
      const el = elements.find(
        (item): item is Extract<typeof item, { type: 'text' }> =>
          item.id === editingTextId && item.type === 'text',
      );
      return el ? ({ kind: 'text' as const, element: el }) : null;
    }
    if (editingShapeLabelId) {
      const el = elements.find(
        (item): item is Extract<typeof item, { type: 'shape' }> =>
          item.id === editingShapeLabelId && item.type === 'shape',
      );
      return el ? ({ kind: 'shapeLabel' as const, element: el }) : null;
    }
    return null;
  }, [editingTextId, editingShapeLabelId, elements]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(screen, useCanvasStore.getState().document.camera);
    await addImageFromFile(file, world.x, world.y);
  };

  return (
    <div
      ref={containerRef}
      className="canvas-viewport"
      style={{ cursor: getCursor(activeTool, isSpacePanning, isPanning) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer
          x={camera.x}
          y={camera.y}
          scaleX={camera.zoom}
          scaleY={camera.zoom}
        >
          <Rect
            name="board-bg"
            x={-100000}
            y={-100000}
            width={200000}
            height={200000}
            fill="#f3f1ec"
            listening
          />

          {elements.map((el) => (
            <ElementRenderer
              key={el.id}
              element={el}
              listening={
                canInteractWithObjects ||
                (activeTool === 'text' && el.type === 'text')
              }
              isEditingText={editingTextId === el.id}
              onSelect={onSelectElement}
              onDragStart={onDragStartElement}
              onDragMove={onDragMoveElement}
              onDragEnd={onDragEndElement}
              onEditText={onEditText}
              onEditShapeLabel={onEditShapeLabel}
            />
          ))}

          {draftPoints && draftPoints.length >= 4 && (
            <Line
              points={draftPoints}
              stroke={style.strokeColor ?? '#1a1a1a'}
              strokeWidth={style.strokeWidth}
              tension={0.35}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}

          {draftShape && <DraftShapePreview draft={draftShape} style={style} />}

          {snapGuides.map((g, i) =>
            g.orientation === 'v' ? (
              <Line
                key={`vg-${i}`}
                points={[g.position, -50000, g.position, 50000]}
                stroke="#38bdf8"
                strokeWidth={1 / camera.zoom}
                dash={[4 / camera.zoom, 4 / camera.zoom]}
                listening={false}
              />
            ) : (
              <Line
                key={`hg-${i}`}
                points={[-50000, g.position, 50000, g.position]}
                stroke="#38bdf8"
                strokeWidth={1 / camera.zoom}
                dash={[4 / camera.zoom, 4 / camera.zoom]}
                listening={false}
              />
            ),
          )}

          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(37, 99, 235, 0.08)"
              stroke="#2563eb"
              strokeWidth={1 / camera.zoom}
              dash={[4 / camera.zoom, 4 / camera.zoom]}
              listening={false}
            />
          )}

          <SelectionTransformer
            selectedIds={selectedIds.filter((id) => {
              const el = elements.find((e) => e.id === id);
              return el && !el.locked;
            })}
            elements={elements}
            enabled={
              canInteractWithObjects && !editingTextId && !editingShapeLabelId
            }
          />
        </Layer>
      </Stage>

      {editingTarget && (
        <TextEditorOverlay
          target={editingTarget}
          camera={camera}
          containerRect={containerRect}
          onChangeText={(text, width, height) => {
            updateElement(editingTarget.element.id, (el) =>
              el.type === 'text' ? { ...el, text, width, height } : el,
            );
          }}
          onChangeLabel={(label) => {
            updateElement(editingTarget.element.id, (el) =>
              el.type === 'shape' ? { ...el, label } : el,
            );
          }}
          onClose={() => {
            setEditingTextId(null);
            setEditingShapeLabelId(null);
            persist();
          }}
        />
      )}
    </div>
  );
}
