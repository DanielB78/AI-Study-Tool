/**
 * Konva hit-target / frame for GraphElement.
 * Visual plot is rendered by GraphHtmlLayer (HTML/Chart.js).
 */

import { Group, Rect, Text } from 'react-konva';
import type { GraphElement } from '../../types/canvas';

interface Props {
  element: GraphElement;
  listening: boolean;
  /** When true, Konva should not steal pan/zoom from the HTML plot. */
  interacting: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick: (id: string) => void;
}

export function GraphNode({
  element,
  listening,
  interacting,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
}: Props) {
  const canDrag = listening && !element.locked && !interacting;

  return (
    <Group
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={element.opacity}
      draggable={canDrag}
      listening={listening && !interacting}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(element.id, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(element.id, false);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onDblClick(element.id);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        onDblClick(element.id);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onDragStart(element.id);
      }}
      onDragMove={(e) => {
        onDragMove(element.id, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
    >
      <Rect
        width={element.width}
        height={element.height}
        fill="rgba(255,255,255,0.92)"
        stroke={interacting ? '#2563eb' : '#cbd5e1'}
        strokeWidth={interacting ? 2.5 : 1.25}
        cornerRadius={8}
        shadowColor="rgba(15,23,42,0.12)"
        shadowBlur={interacting ? 12 : 4}
        shadowOffsetY={2}
        shadowOpacity={1}
      />
      {/* Fallback label if HTML layer fails to mount */}
      <Text
        text={element.settings.title || 'Graph'}
        x={10}
        y={8}
        fontSize={12}
        fill="#94a3b8"
        listening={false}
        opacity={0}
      />
    </Group>
  );
}
