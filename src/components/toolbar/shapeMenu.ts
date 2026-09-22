import type { LucideIcon } from 'lucide-react';
import {
  Circle,
  Diamond,
  Hexagon,
  MessageSquare,
  Pentagon,
  Square,
  SquareRoundCorner,
  Star,
  Triangle,
  MoveHorizontal,
} from 'lucide-react';
import type { ShapeType } from '../../types/canvas';

export interface ShapeMenuItem {
  id: ShapeType;
  label: string;
  icon: LucideIcon;
}

/** Extensible registry for the shapes popover. */
export const SHAPE_MENU_ITEMS: ShapeMenuItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'roundedRect', label: 'Rounded rectangle', icon: SquareRoundCorner },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'pentagon', label: 'Pentagon', icon: Pentagon },
  { id: 'hexagon', label: 'Hexagon', icon: Hexagon },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'parallelogram', label: 'Parallelogram', icon: MoveHorizontal },
  { id: 'callout', label: 'Callout', icon: MessageSquare },
];
