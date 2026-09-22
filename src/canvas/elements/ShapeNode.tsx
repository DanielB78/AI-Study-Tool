import { Ellipse, Group, Line, Rect, Text } from 'react-konva';
import type { ShapeElement } from '../../types/canvas';
import { strokeDashFor } from '../../types/canvas';
import { shapePointsFor } from '../../utils/shapeGeometry';

interface Props {
  element: ShapeElement;
  listening: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick: (id: string) => void;
}

function Label({ element }: { element: ShapeElement }) {
  if (!element.label) return null;
  const pad = 8;
  return (
    <Text
      x={pad}
      y={pad}
      width={Math.max(element.width - pad * 2, 1)}
      height={Math.max(element.height - pad * 2, 1)}
      text={element.label}
      fontSize={element.labelFontSize}
      fontFamily={element.labelFontFamily}
      fontStyle={[
        element.labelFontWeight === 'bold' ? 'bold' : '',
        element.labelFontItalic ? 'italic' : '',
      ]
        .filter(Boolean)
        .join(' ') || 'normal'}
      fill={element.labelColor}
      align="center"
      verticalAlign="middle"
      listening={false}
      wrap="word"
    />
  );
}

export function ShapeNode({
  element,
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
}: Props) {
  const dash = strokeDashFor(element.strokeStyle, element.strokeWidth);
  const fill = element.fill ?? 'rgba(0,0,0,0)';
  const stroke = element.stroke ?? 'rgba(0,0,0,0)';
  const strokeEnabled = Boolean(element.stroke) && element.strokeWidth > 0;
  const canDrag = listening && !element.locked;

  const commonGroup = {
    id: element.id,
    name: 'canvas-element',
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
    draggable: canDrag,
    listening,
    onClick: (e: { cancelBubble: boolean; evt: { shiftKey: boolean } }) => {
      e.cancelBubble = true;
      onSelect(element.id, e.evt.shiftKey);
    },
    onTap: (e: { cancelBubble: boolean }) => {
      e.cancelBubble = true;
      onSelect(element.id, false);
    },
    onDblClick: (e: { cancelBubble: boolean }) => {
      e.cancelBubble = true;
      onDblClick(element.id);
    },
    onDblTap: (e: { cancelBubble: boolean }) => {
      e.cancelBubble = true;
      onDblClick(element.id);
    },
    onDragStart: () => onDragStart(element.id),
    onDragMove: (e: { target: { x: () => number; y: () => number } }) =>
      onDragMove(element.id, e.target.x(), e.target.y()),
    onDragEnd: (e: { target: { x: () => number; y: () => number } }) =>
      onDragEnd(element.id, e.target.x(), e.target.y()),
  };

  if (element.shapeType === 'ellipse') {
    return (
      <Group {...commonGroup}>
        <Ellipse
          x={element.width / 2}
          y={element.height / 2}
          radiusX={Math.max(element.width / 2, 0.5)}
          radiusY={Math.max(element.height / 2, 0.5)}
          fill={fill}
          stroke={stroke}
          strokeWidth={element.strokeWidth}
          dash={dash}
          strokeEnabled={strokeEnabled}
        />
        <Label element={element} />
      </Group>
    );
  }

  if (element.shapeType === 'rectangle' || element.shapeType === 'roundedRect') {
    return (
      <Group {...commonGroup}>
        <Rect
          width={element.width}
          height={element.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={element.strokeWidth}
          dash={dash}
          strokeEnabled={strokeEnabled}
          cornerRadius={
            element.shapeType === 'roundedRect' ? element.cornerRadius : 0
          }
        />
        <Label element={element} />
      </Group>
    );
  }

  const points = shapePointsFor(element.shapeType, element.width, element.height, {
    starPoints: element.starPoints,
    starInnerRatio: element.starInnerRatio,
  });

  return (
    <Group {...commonGroup}>
      {points && (
        <Line
          points={points}
          closed
          fill={fill}
          stroke={stroke}
          strokeWidth={element.strokeWidth}
          dash={dash}
          strokeEnabled={strokeEnabled}
          lineJoin="round"
        />
      )}
      <Label element={element} />
    </Group>
  );
}
