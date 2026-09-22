import { Line } from 'react-konva';
import type { DrawingElement } from '../../types/canvas';

interface Props {
  element: DrawingElement;
  listening: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export function DrawingNode({
  element,
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  return (
    <Line
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      points={element.points}
      stroke={element.color}
      strokeWidth={element.strokeWidth}
      tension={0.35}
      lineCap="round"
      lineJoin="round"
      rotation={element.rotation}
      draggable={listening}
      listening={listening}
      hitStrokeWidth={Math.max(12, element.strokeWidth + 8)}
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
