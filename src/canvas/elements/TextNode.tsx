import { useRef } from 'react';
import { Group, Rect, Text } from 'react-konva';
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

function konvaFontStyle(el: TextElement): string {
  const parts: string[] = [];
  if (el.fontWeight === 'bold') parts.push('bold');
  if (el.fontItalic) parts.push('italic');
  return parts.join(' ') || 'normal';
}

function konvaDecoration(el: TextElement): string {
  const parts: string[] = [];
  if (el.underline) parts.push('underline');
  if (el.strikethrough) parts.push('line-through');
  return parts.join(' ');
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
  const canDrag = listening && !isEditing && !element.locked;

  const handleClick = (shiftKey: boolean) => {
    const now = Date.now();
    if (now - lastClickAt.current < 350) {
      lastClickAt.current = 0;
      if (!element.locked) onDblClick(element.id);
      return;
    }
    lastClickAt.current = now;
    onSelect(element.id, shiftKey);
  };

  return (
    <Group
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={element.opacity}
      draggable={canDrag}
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
        if (!element.locked) onDblClick(element.id);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        if (!element.locked) onDblClick(element.id);
      }}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => onDragMove(element.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(element.id, e.target.x(), e.target.y())}
    >
      <Rect
        width={Math.max(element.width, 24)}
        height={Math.max(element.height, element.fontSize * element.lineHeight)}
        fill={element.backgroundColor ?? 'rgba(0,0,0,0.001)'}
        cornerRadius={element.cornerRadius}
      />
      <Text
        x={element.padding}
        y={element.padding}
        width={Math.max(element.width - element.padding * 2, 1)}
        height={Math.max(element.height - element.padding * 2, 1)}
        text={element.text}
        fontSize={element.fontSize}
        fontFamily={element.fontFamily}
        fontStyle={konvaFontStyle(element)}
        textDecoration={konvaDecoration(element)}
        fill={element.color}
        align={element.alignment}
        verticalAlign="top"
        lineHeight={element.lineHeight}
        wrap="word"
        opacity={isEditing ? 0 : 1}
        listening={false}
      />
    </Group>
  );
}
