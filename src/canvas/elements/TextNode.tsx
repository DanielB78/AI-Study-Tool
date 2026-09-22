import { useRef } from 'react';
import { Text } from 'react-konva';
import type { TextElement } from '../../types/canvas';

interface Props {
  element: TextElement;
  listening: boolean;
  isEditing: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick: (id: string) => void;
}

export function TextNode({
  element,
  listening,
  isEditing,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
}: Props) {
  const lastClickAt = useRef(0);

  const handleClick = (shiftKey: boolean) => {
    const now = Date.now();
    // Custom double-click: Transformer often steals the 2nd native click after selection.
    if (now - lastClickAt.current < 350) {
      lastClickAt.current = 0;
      onDblClick(element.id);
      return;
    }
    lastClickAt.current = now;
    onSelect(element.id, shiftKey);
  };

  return (
    <Text
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      text={element.text}
      fontSize={element.fontSize}
      fontFamily={element.fontFamily}
      fontStyle={element.fontStyle}
      fill={element.color}
      align={element.alignment}
      verticalAlign="top"
      padding={4}
      rotation={element.rotation}
      opacity={isEditing ? 0 : 1}
      draggable={listening && !isEditing}
      listening={listening}
      onClick={(e) => {
        e.cancelBubble = true;
        handleClick(e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        handleClick(false);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onDblClick(element.id);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        onDblClick(element.id);
      }}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => onDragMove(element.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(element.id, e.target.x(), e.target.y())}
    />
  );
}
