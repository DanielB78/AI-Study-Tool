import type { ShapeType } from '../../types/canvas';
import { SHAPE_MENU_ITEMS } from './shapeMenu';

interface ShapesPopoverProps {
  activeShape: ShapeType | null;
  onSelect: (shape: ShapeType) => void;
}

export function ShapesPopover({ activeShape, onSelect }: ShapesPopoverProps) {
  return (
    <div className="shapes-popover" role="menu" aria-label="Shapes">
      <div className="shapes-popover-grid">
        {SHAPE_MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={
                activeShape === item.id
                  ? 'shapes-popover-btn active'
                  : 'shapes-popover-btn'
              }
              title={item.label}
              aria-label={item.label}
              onClick={() => onSelect(item.id)}
            >
              <Icon size={22} strokeWidth={1.75} absoluteStrokeWidth />
              <span className="shapes-popover-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
