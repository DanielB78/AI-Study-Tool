import { useRef } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { TextElement } from '../../types/canvas';
import { textElementNeedsHtmlOverlay } from '../../features/text/textFeatures';
import {
  getComponentType,
  labelForComponent,
  TEXT_COMPONENT_STYLES,
} from '../../features/text/textComponents';

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

function metaNum(el: TextElement, key: string, fallback: number): number {
  const v = el.metadata?.[key];
  return typeof v === 'number' ? v : fallback;
}

function metaColor(el: TextElement, key: string): string | null {
  const v = el.metadata?.[key];
  if (typeof v === 'string') return v;
  return null;
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

  const componentType = getComponentType(element);
  const preset = TEXT_COMPONENT_STYLES[componentType];
  const borderColor =
    metaColor(element, 'borderColor') ?? preset.borderColor;
  const borderWidth = metaNum(element, 'borderWidth', preset.borderWidth);
  const accentColor =
    metaColor(element, 'accentBorderColor') ?? preset.accentBorderColor;
  const accentWidth = metaNum(
    element,
    'accentBorderWidth',
    preset.accentBorderWidth,
  );
  const label = labelForComponent(componentType, element.componentMeta);
  const labelHeight = label
    ? Math.round(element.fontSize * 0.85) + 6
    : 0;
  const useHtml = textElementNeedsHtmlOverlay(element);
  const w = Math.max(element.width, 24);
  const h = Math.max(element.height, element.fontSize * element.lineHeight);

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
        width={w}
        height={h}
        fill={element.backgroundColor ?? 'rgba(0,0,0,0.001)'}
        cornerRadius={element.cornerRadius}
        stroke={borderColor ?? undefined}
        strokeWidth={borderColor ? borderWidth : 0}
      />
      {accentColor && accentWidth > 0 && (
        <Rect
          x={0}
          y={0}
          width={accentWidth}
          height={h}
          fill={accentColor}
          cornerRadius={[
            element.cornerRadius,
            0,
            0,
            element.cornerRadius,
          ]}
          listening={false}
        />
      )}
      {!useHtml && label && (
        <Text
          x={element.padding + (accentColor ? accentWidth : 0)}
          y={element.padding}
          width={Math.max(
            w - element.padding * 2 - (accentColor ? accentWidth : 0),
            1,
          )}
          text={label.toUpperCase()}
          fontSize={Math.round(element.fontSize * 0.78)}
          fontFamily={element.fontFamily}
          fontStyle="bold"
          fill={element.color}
          opacity={isEditing ? 0 : 0.7}
          listening={false}
        />
      )}
      {/* Rich-text / titled / noted / labelled components render via TextHtmlLayer. */}
      {!useHtml && (
        <Text
          x={element.padding + (accentColor ? accentWidth : 0)}
          y={element.padding + labelHeight}
          width={Math.max(
            w - element.padding * 2 - (accentColor ? accentWidth : 0),
            1,
          )}
          height={Math.max(h - element.padding * 2 - labelHeight, 1)}
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
      )}
    </Group>
  );
}
