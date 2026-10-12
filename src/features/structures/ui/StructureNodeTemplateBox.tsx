import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NodeTemplate } from '../types';

interface StructureNodeTemplateBoxProps {
  template: NodeTemplate;
  /** Absolute position on the structure editor canvas (section origin + template relative). */
  absX: number;
  absY: number;
  scale: number;
  selected: boolean;
  role: 'root' | 'child';
  readOnly?: boolean;
  /** Dimmed read-only preview clone (not the editable primary child). */
  isPreviewClone?: boolean;
  onSelect: () => void;
  onGeometryChange?: (geom: {
    relativeX: number;
    relativeY: number;
    width: number;
    height: number;
  }) => void;
  /** Template relative coords before drag (for geometry updates). */
  templateRelative: { relativeX: number; relativeY: number };
}

/**
 * Textbox-like structure editor component for root/child node templates.
 * Same drag/resize interaction model as fixed structure Text fields.
 */
export function StructureNodeTemplateBox({
  template,
  absX,
  absY,
  scale,
  selected,
  role,
  readOnly,
  isPreviewClone,
  onSelect,
  onGeometryChange,
  templateRelative,
}: StructureNodeTemplateBoxProps) {
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || isPreviewClone || !onGeometryChange) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...templateRelative, w: template.width, h: template.height };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onGeometryChange({
        relativeX: Math.max(0, Math.round(orig.relativeX + dx)),
        relativeY: Math.max(0, Math.round(orig.relativeY + dy)),
        width: orig.w,
        height: orig.h,
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
    if (readOnly || isPreviewClone || !onGeometryChange) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...templateRelative, w: template.width, h: template.height };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onGeometryChange({
        relativeX: orig.relativeX,
        relativeY: orig.relativeY,
        width: Math.max(64, Math.round(orig.w + dx)),
        height: Math.max(40, Math.round(orig.h + dy)),
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
      className={`structure-field-box structure-node-template${
        selected ? ' is-selected' : ''
      }${role === 'root' ? ' is-root-template' : ' is-child-template'}${
        isPreviewClone ? ' is-preview-clone' : ''
      }`}
      style={{
        left: absX * scale,
        top: absY * scale,
        width: template.width * scale,
        height: template.height * scale,
        backgroundColor: template.style.backgroundColor ?? '#fff',
        color: template.style.color,
        fontSize: Math.max(10, template.style.fontSize * scale * 0.85),
        fontWeight: template.style.fontWeight,
        fontStyle: template.style.fontItalic ? 'italic' : 'normal',
        textDecoration: template.style.underline ? 'underline' : 'none',
        textAlign: template.style.alignment,
        borderRadius: template.style.cornerRadius * scale,
        padding: Math.max(4, template.style.padding * scale * 0.6),
        zIndex: isPreviewClone ? 1 : selected ? 20 : role === 'root' ? 12 : 11,
        opacity: isPreviewClone ? 0.55 : 1,
        pointerEvents: isPreviewClone ? 'none' : undefined,
      }}
      onPointerDown={startDrag}
      role="button"
      tabIndex={isPreviewClone ? -1 : 0}
      aria-label={`${role === 'root' ? 'Root' : 'Child'} node template ${template.label}`}
      onKeyDown={(e) => {
        if (isPreviewClone) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="structure-field-box-label">
        {template.label}
        <span className="structure-field-box-meta">
          {role === 'root' ? 'ROOT TEMPLATE' : isPreviewClone ? 'PREVIEW' : 'CHILD TEMPLATE'}
        </span>
      </div>
      <div className="structure-field-box-instruction structure-node-instruction">
        <span className="structure-node-instruction-badge">AI instruction</span>
        {template.instruction}
      </div>
      {!readOnly && !isPreviewClone && selected && (
        <span
          className="structure-field-resize"
          onPointerDown={startResize}
          aria-hidden
        />
      )}
    </div>
  );
}
