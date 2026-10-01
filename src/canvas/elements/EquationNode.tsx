/**
 * Konva hit-target for EquationElement. Visual math is drawn by EquationHtmlLayer
 * so KaTeX stays sharp under zoom (HTML overlay, not rasterized Konva text).
 */

import { Group, Rect, Text } from 'react-konva';
import type { EquationElement } from '../../types/canvas';
import { validateLatex } from '../../features/equations/latex';

interface Props {
  element: EquationElement;
  listening: boolean;
  isEditing: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick: (id: string) => void;
}

export function EquationNode({
  element,
  listening,
  isEditing,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
}: Props) {
  const validation = validateLatex(element.latex, element.displayMode !== 'inline');
  const showError = !validation.ok;

  return (
    <Group
      id={element.id}
      name="canvas-element"
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={isEditing ? 0 : element.opacity}
      draggable={listening && !element.locked}
      listening={listening}
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
        fill={showError ? 'rgba(255, 240, 240, 0.95)' : 'rgba(255,255,255,0.01)'}
        stroke={showError ? '#c0392b' : undefined}
        strokeWidth={showError ? 1 : 0}
        cornerRadius={6}
      />
      {showError && (
        <Text
          text={`Invalid LaTeX\n${element.latex.slice(0, 80)}`}
          width={element.width}
          height={element.height}
          padding={8}
          fontSize={12}
          fill="#c0392b"
          listening={false}
        />
      )}
    </Group>
  );
}
