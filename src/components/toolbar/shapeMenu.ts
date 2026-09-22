import type { ShapeType } from '../../types/canvas';
import type { LucideIcon } from 'lucide-react';
import { Circle, Square } from 'lucide-react';

export interface ShapeMenuItem {
  id: ShapeType;
  label: string;
  icon: LucideIcon;
}

/** Extensible registry — add triangle/diamond/etc. here later. */
export const SHAPE_MENU_ITEMS: ShapeMenuItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
];
