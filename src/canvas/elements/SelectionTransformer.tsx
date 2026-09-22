import { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import type { CanvasElement } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';

interface Props {
  selectedIds: string[];
  elements: CanvasElement[];
  enabled: boolean;
}

export function SelectionTransformer({ selectedIds, elements, enabled }: Props) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const beginInteraction = useCanvasStore((s) => s.beginInteraction);
  const endInteraction = useCanvasStore((s) => s.endInteraction);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const persist = useCanvasStore((s) => s.persist);
  const setEditingTextId = useCanvasStore((s) => s.setEditingTextId);
  const setEditingShapeLabelId = useCanvasStore((s) => s.setEditingShapeLabelId);
  const pushHistory = useCanvasStore((s) => s.pushHistory);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    if (!stage || !enabled || selectedIds.length === 0) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    const nodes = selectedIds
      .map((id) => stage.findOne(`#${CSS.escape(id)}`))
      .filter((n): n is Konva.Node => Boolean(n));

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, elements, enabled]);

  if (!enabled) return null;

  const single = selectedIds.length === 1
    ? elements.find((el) => el.id === selectedIds[0])
    : undefined;

  const keepRatio = single?.type === 'image';
  const rotateEnabled = single?.type !== 'drawing' && single?.type !== 'connector';

  return (
    <Transformer
      ref={transformerRef}
      rotateEnabled={rotateEnabled}
      keepRatio={keepRatio}
      enabledAnchors={
        single?.type === 'drawing' || single?.type === 'connector'
          ? []
          : undefined
      }
      boundBoxFunc={(oldBox, newBox) => {
        if (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8) {
          return oldBox;
        }
        return newBox;
      }}
      onTransformStart={() => beginInteraction()}
      onDblClick={() => {
        if (single?.type === 'text' && !single.locked) {
          pushHistory();
          setEditingTextId(single.id);
        } else if (single?.type === 'shape' && !single.locked) {
          pushHistory();
          setEditingShapeLabelId(single.id);
        }
      }}
      onTransformEnd={() => {
        const tr = transformerRef.current;
        if (!tr) return;
        for (const node of tr.nodes()) {
          const id = node.id();
          const el = elements.find((e) => e.id === id);
          if (!el || el.locked) continue;

          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);

          if (el.type === 'connector' || el.type === 'drawing') {
            updateElement(id, (prev) => ({
              ...prev,
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
            }));
          } else {
            const width = Math.max(8, Math.abs(el.width * scaleX));
            const height = Math.max(8, Math.abs(el.height * scaleY));
            updateElement(id, (prev) => ({
              ...prev,
              x: node.x(),
              y: node.y(),
              width,
              height,
              rotation: node.rotation(),
            }));
          }
        }
        endInteraction();
        persist();
      }}
    />
  );
}
