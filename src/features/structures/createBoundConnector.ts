/**
 * Create a ConnectorElement bound to parent/child node TextElements.
 * Attachment edges depend on Children Placement (below / sideways / around).
 */

import type {
  ConnectorElement,
  ConnectorType,
  StrokeStyle,
  ArrowHeads,
} from '../../types/canvas';
import { createBaseFields } from '../../utils/ids';
import type { NodeChildrenPlacement } from './types';

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
  childrenPlacement: NodeChildrenPlacement;
  style: BoundConnectorStyle;
  zIndex: number;
  metadata?: Record<string, unknown>;
}

function edgePoint(
  box: BoundConnectorEndpoints['parent'],
  toward: BoundConnectorEndpoints['child'],
): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const tx = toward.x + toward.width / 2;
  const ty = toward.y + toward.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx >= 0 ? box.x + box.width : box.x,
      y: cy,
    };
  }
  return {
    x: cx,
    y: dy >= 0 ? box.y + box.height : box.y,
  };
}

/** Attach to mid-edges based on placement mode. */
function attachmentPoints(
  parent: BoundConnectorEndpoints['parent'],
  child: BoundConnectorEndpoints['child'],
  placement: NodeChildrenPlacement,
): { x1: number; y1: number; x2: number; y2: number } {
  if (placement === 'below') {
    return {
      x1: parent.x + parent.width / 2,
      y1: parent.y + parent.height,
      x2: child.x + child.width / 2,
      y2: child.y,
    };
  }
  if (placement === 'sideways') {
    return {
      x1: parent.x + parent.width,
      y1: parent.y + parent.height / 2,
      x2: child.x,
      y2: child.y + child.height / 2,
    };
  }
  // around: nearest edges between boxes
  const p = edgePoint(parent, child);
  const c = edgePoint(child, parent);
  return { x1: p.x, y1: p.y, x2: c.x, y2: c.y };
}

export function createBoundConnector(input: BoundConnectorEndpoints): ConnectorElement {
  const { x1, y1, x2, y2 } = attachmentPoints(
    input.parent,
    input.child,
    input.childrenPlacement,
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
      parentNodeElementId: input.parent.id,
      childNodeElementId: input.child.id,
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
