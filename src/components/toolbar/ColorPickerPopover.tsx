import { useEffect, useRef, useState } from 'react';

const PRESETS = [
  '#000000',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#78716c',
  '#fef3c7',
  '#dbeafe',
  '#fce7f3',
  '#dcfce7',
];

const RECENT_KEY = 'ai-study-tool:recent-colors';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(color: string) {
  if (!color || color === 'transparent') return;
  const next = [color, ...loadRecent().filter((c) => c !== color)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

interface ColorPickerPopoverProps {
  value: string | null;
  allowTransparent?: boolean;
  onChange: (color: string | null) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function ColorPickerPopover({
  value,
  allowTransparent = true,
  onChange,
  onClose,
}: ColorPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(value && value !== 'transparent' ? value : '#000000');
  const [recent, setRecent] = useState(loadRecent);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const apply = (color: string | null) => {
    onChange(color);
    if (color) {
      pushRecent(color);
      setRecent(loadRecent());
      setHex(color);
    }
  };

  return (
    <div className="ui-popover color-popover" ref={ref} role="dialog" aria-label="Colour">
      <div className="swatch-grid">
        {allowTransparent && (
          <button
            type="button"
            className={value === null ? 'swatch transparent active' : 'swatch transparent'}
            title="No colour"
            onClick={() => apply(null)}
          />
        )}
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={value === c ? 'swatch active' : 'swatch'}
            style={{ background: c }}
            title={c}
            onClick={() => apply(c)}
          />
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <div className="popover-label">Recent</div>
          <div className="swatch-grid">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                className={value === c ? 'swatch active' : 'swatch'}
                style={{ background: c }}
                title={c}
                onClick={() => apply(c)}
              />
            ))}
          </div>
        </>
      )}

      <div className="color-row">
        <input
          type="color"
          value={hex}
          onChange={(e) => apply(e.target.value)}
          aria-label="Colour picker"
        />
        <input
          className="hex-input"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            const v = hex.trim();
            if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) apply(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = hex.trim();
              if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) apply(v);
            }
          }}
          aria-label="HEX colour"
        />
      </div>
    </div>
  );
}

interface ColorSwatchButtonProps {
  label: string;
  value: string | null;
  allowTransparent?: boolean;
  onChange: (color: string | null) => void;
}

export function ColorSwatchButton({
  label,
  value,
  allowTransparent = true,
  onChange,
}: ColorSwatchButtonProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="ctx-control">
      <button
        ref={btnRef}
        type="button"
        className="color-swatch-btn"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="color-swatch-label">{label}</span>
        <span
          className={value ? 'color-swatch-chip' : 'color-swatch-chip none'}
          style={value ? { background: value } : undefined}
        />
      </button>
      {open && (
        <ColorPickerPopover
          value={value}
          allowTransparent={allowTransparent}
          onChange={(c) => {
            onChange(c);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
