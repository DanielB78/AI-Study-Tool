import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}

export function CtxPopover({ label, icon, children, wide }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="ctx-control" ref={ref}>
      <button
        type="button"
        className={open ? 'ctx-chip active' : 'ctx-chip'}
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className={wide ? 'ui-popover wide' : 'ui-popover'} role="dialog">
          {children}
        </div>
      )}
    </div>
  );
}

interface OpacityControlProps {
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

export function OpacityControl({ value, onChange, onCommit }: OpacityControlProps) {
  return (
    <CtxPopover label="Opacity">
      <div className="popover-row">
        <input
          type="range"
          min={5}
          max={100}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          onPointerUp={(e) =>
            onCommit(Number((e.target as HTMLInputElement).value) / 100)
          }
        />
        <span className="ctx-range-value">{Math.round(value * 100)}%</span>
      </div>
    </CtxPopover>
  );
}
