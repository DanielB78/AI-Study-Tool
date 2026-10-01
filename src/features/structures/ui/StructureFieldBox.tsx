import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NoteStructureField } from '../types';

interface StructureFieldBoxProps {
  field: NoteStructureField;
  selected: boolean;
  scale: number;
  onSelect: () => void;
  onGeometryChange: (geom: {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
  }) => void;
  readOnly?: boolean;
}

/**
 * Editor placeholder for a structure field — label + AI instruction (not generated content).
 */
export function StructureFieldBox({
  field,
  selected,
  scale,
  onSelect,
  onGeometryChange,
  readOnly,
}: StructureFieldBoxProps) {
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = {
      x: field.relativeX,
      y: field.relativeY,
      w: field.relativeWidth,
      h: field.relativeHeight,
    };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onGeometryChange({
        relativeX: Math.max(0, Math.round(orig.x + dx)),
        relativeY: Math.max(0, Math.round(orig.y + dy)),
        relativeWidth: orig.w,
        relativeHeight: orig.h,
      });
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = {
      x: field.relativeX,
      y: field.relativeY,
      w: field.relativeWidth,
      h: field.relativeHeight,
    };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onGeometryChange({
        relativeX: orig.x,
        relativeY: orig.y,
        relativeWidth: Math.max(48, Math.round(orig.w + dx)),
        relativeHeight: Math.max(36, Math.round(orig.h + dy)),
      });
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`structure-field-box${selected ? ' is-selected' : ''}${
        field.contentType === 'equation' ? ' is-equation' : ''
      }`}
      style={{
        left: field.relativeX * scale,
        top: field.relativeY * scale,
        width: field.relativeWidth * scale,
        height: field.relativeHeight * scale,
        zIndex: field.zIndex + 1,
        backgroundColor: field.style.backgroundColor ?? '#fff',
        color: field.style.color,
        fontSize: Math.max(10, field.style.fontSize * scale * 0.85),
      }}
      onPointerDown={startDrag}
      role="button"
      tabIndex={0}
      aria-label={`Field ${field.label}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="structure-field-box-label">
        {field.label}
        <span className="structure-field-box-meta">
          {field.contentType.toUpperCase()}
          {field.required ? '' : ' · optional'}
        </span>
      </div>
      <div className="structure-field-box-instruction">{field.instruction}</div>
      {!readOnly && selected && (
        <span
          className="structure-field-resize"
          onPointerDown={startResize}
          aria-hidden
        />
      )}
    </div>
  );
}
