import type { CanvasElement } from '../../types/canvas';
import { ConnectorNode } from './ConnectorNode';
import { DrawingNode } from './DrawingNode';
import { ImageNode } from './ImageNode';
import { ShapeNode } from './ShapeNode';
import { TextNode } from './TextNode';

interface Props {
  element: CanvasElement;
  listening: boolean;
  draggable?: boolean;
  isEditingText: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onEditText: (id: string) => void;
}

export function ElementRenderer({
  element,
  listening,
  draggable = listening,
  isEditingText,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onEditText,
}: Props) {
  switch (element.type) {
    case 'text':
      return (
        <TextNode
          element={element}
          listening={listening}
          draggable={draggable}
          isEditing={isEditingText}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDblClick={onEditText}
        />
      );
    case 'shape':
      return (
        <ShapeNode
          element={element}
          listening={listening}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      );
    case 'drawing':
      return (
        <DrawingNode
          element={element}
          listening={listening}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      );
    case 'image':
      return (
        <ImageNode
          element={element}
          listening={listening}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      );
    case 'connector':
      return (
        <ConnectorNode
          element={element}
          listening={listening}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      );
    default: {
      const _exhaustive: never = element;
      return _exhaustive;
    }
  }
}
