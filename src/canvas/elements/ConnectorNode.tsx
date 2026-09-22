import { Arrow, Line } from 'react-konva';
import type { ConnectorElement } from '../../types/canvas';

interface Props {
  element: ConnectorElement;
  listening: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export function ConnectorNode({
  element,
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const shared = {
    id: element.id,
    name: 'canvas-element',
    x: element.x,
    y: element.y,
    points: element.points as number[],
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    rotation: element.rotation,
    draggable: listening,
    listening,
    hitStrokeWidth: Math.max(14, element.strokeWidth + 10),
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    onClick: (e: { cancelBubble: boolean; evt: { shiftKey: boolean } }) => {
      e.cancelBubble = true;
      onSelect(element.id, e.evt.shiftKey);
    },
    onTap: (e: { cancelBubble: boolean }) => {
      e.cancelBubble = true;
      onSelect(element.id, false);
    },
    onDragStart: () => onDragStart(element.id),
    onDragMove: (e: { target: { x: () => number; y: () => number } }) => {
      onDragMove(element.id, e.target.x(), e.target.y());
    },
    onDragEnd: (e: { target: { x: () => number; y: () => number } }) => {
      onDragEnd(element.id, e.target.x(), e.target.y());
    },
  };

  if (element.connectorType === 'arrow') {
    return (
      <Arrow
        {...shared}
        pointerLength={12}
        pointerWidth={12}
        fill={element.stroke}
      />
    );
  }

  return <Line {...shared} />;
}
