import { Arrow, Line } from 'react-konva';
import type { ConnectorElement } from '../../types/canvas';
import { strokeDashFor } from '../../types/canvas';

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
  const dash = strokeDashFor(element.strokeStyle, element.strokeWidth);
  const canDrag = listening && !element.locked;
  const shared = {
    id: element.id,
    name: 'canvas-element',
    x: element.x,
    y: element.y,
    points: element.points as number[],
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    dash,
    opacity: element.opacity,
    rotation: element.rotation,
    draggable: canDrag,
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

  const heads = element.arrowHeads;
  const showArrow =
    element.connectorType === 'arrow' || heads === 'end' || heads === 'both';

  if (showArrow && heads !== 'none') {
    return (
      <Arrow
        {...shared}
        pointerLength={12}
        pointerWidth={12}
        fill={element.stroke}
        pointerAtBeginning={heads === 'both'}
        pointerAtEnding={heads === 'end' || heads === 'both'}
      />
    );
  }

  return <Line {...shared} />;
}
