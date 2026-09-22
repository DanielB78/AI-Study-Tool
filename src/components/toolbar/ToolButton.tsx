import type { LucideIcon } from 'lucide-react';

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: boolean | 'menu' | 'dialog';
}

export function ToolButton({
  label,
  shortcut,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHasPopup,
}: ToolButtonProps) {
  const tip = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      type="button"
      className={active ? 'ftb-btn active' : 'ftb-btn'}
      title={tip}
      aria-label={tip}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.85} absoluteStrokeWidth />
    </button>
  );
}
