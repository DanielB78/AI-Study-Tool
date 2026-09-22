import { Ellipse, Rect } from 'react-konva';
import type { ShapeElement } from '../../types/canvas';

interface Props {
  element: ShapeElement;
  listening: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export function ShapeNode({
  element,
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  if (element.shapeType === 'ellipse') {
    return (
      <Ellipse
        id={element.id}
        name="canvas-element"
        x={element.x + element.width / 2}
        y={element.y + element.height / 2}
        radiusX={Math.max(element.width / 2, 0.5)}
        radiusY={Math.max(element.height / 2, 0.5)}
        rotation={element.rotation}
        fill={element.fill}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        draggable={listening}
        listening={listening}
        onClick={(e) => {
          e.cancelBubble = true;
          onSelect(element.id, e.evt.shiftKey);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onSelect(element.id, false);
        }}
        onDragStart={() => onDragStart(element.id)}
        onDragMove={(e) => {
          onDragMove(
            element.id,
            e.target.x() - element.width / 2,
            e.target.y() - element.height / 2,
          );
        }}
        onDragEnd={(e) => {
          onDragEnd(
            element.id,
            e.target.x() - element.width / 2,
            e.target.y() - element.height / 2,
          );
        }}
      />
    );
  }

  return (
    <Rect
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      fill={element.fill}
      stroke={element.stroke}
      strokeWidth={element.strokeWidth}
      draggable={listening}
      listening={listening}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(element.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(element.id, false);
      }}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => onDragMove(element.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(element.id, e.target.x(), e.target.y())}
    />
  );
}
