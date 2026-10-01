/**
 * Create a ConnectorElement bound to parent/child node elements.
 */

import type {
  ConnectorElement,
  ConnectorType,
  StrokeStyle,
  ArrowHeads,
} from '../../types/canvas';
import { createBaseFields } from '../../utils/ids';
import type { NodeSectionLayoutMode } from './types';

export interface BoundConnectorStyle {
  connectorType: ConnectorType;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  color: string;
  arrowHeads: ArrowHeads;
}

export interface BoundConnectorEndpoints {
  parent: { id: string; x: number; y: number; width: number; height: number };
  child: { id: string; x: number; y: number; width: number; height: number };
  layoutMode: NodeSectionLayoutMode;
  style: BoundConnectorStyle;
  zIndex: number;
  metadata?: Record<string, unknown>;
}

/** Attach to mid-edges based on tree orientation. */
function attachmentPoints(
  parent: BoundConnectorEndpoints['parent'],
  child: BoundConnectorEndpoints['child'],
  layoutMode: NodeSectionLayoutMode,
): { x1: number; y1: number; x2: number; y2: number } {
  if (layoutMode === 'tree_vertical') {
    return {
      x1: parent.x + parent.width / 2,
      y1: parent.y + parent.height,
      x2: child.x + child.width / 2,
      y2: child.y,
    };
  }
  return {
    x1: parent.x + parent.width,
    y1: parent.y + parent.height / 2,
    x2: child.x,
    y2: child.y + child.height / 2,
  };
}

export function createBoundConnector(input: BoundConnectorEndpoints): ConnectorElement {
  const { x1, y1, x2, y2 } = attachmentPoints(
    input.parent,
    input.child,
    input.layoutMode,
  );
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const base = createBaseFields({
    x: minX,
    y: minY,
    width,
    height,
    zIndex: input.zIndex,
    opacity: 1,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: 'create_structured_note',
      relationshipType: 'parent_child',
      ...(input.metadata ?? {}),
    },
  });

  const arrowHeads =
    input.style.connectorType === 'arrow'
      ? input.style.arrowHeads === 'none'
        ? 'end'
        : input.style.arrowHeads
      : 'none';

  return {
    ...base,
    type: 'connector',
    connectorType: input.style.connectorType,
    points: [x1 - minX, y1 - minY, x2 - minX, y2 - minY],
    stroke: input.style.color,
    strokeWidth: input.style.strokeWidth,
    strokeStyle: input.style.strokeStyle,
    arrowHeads,
    startBindingId: input.parent.id,
    endBindingId: input.child.id,
  };
}
