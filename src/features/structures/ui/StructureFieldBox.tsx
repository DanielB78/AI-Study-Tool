import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StructureComponent } from '../types';
import { isNodeSection } from '../types';
import {
  layoutNodeSectionHierarchy,
  previewHierarchyForSection,
} from '../nodeSectionLayout';

interface StructureFieldBoxProps {
  field: StructureComponent;
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
 * Editor placeholder for a structure component — fixed field or Node Section preview.
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
        relativeWidth: Math.max(80, Math.round(orig.w + dx)),
        relativeHeight: Math.max(60, Math.round(orig.h + dy)),
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

  const nodeSection = isNodeSection(field) ? field : null;
  const previewLayout = nodeSection
    ? layoutNodeSectionHierarchy(
        previewHierarchyForSection(nodeSection.layoutMode),
        nodeSection,
      )
    : null;
  const previewScale = previewLayout
    ? Math.min(
        (field.relativeWidth * scale - 16) / Math.max(1, previewLayout.bounds.width),
        (field.relativeHeight * scale - 40) / Math.max(1, previewLayout.bounds.height),
        1,
      )
    : 1;

  return (
    <div
      className={`structure-field-box${selected ? ' is-selected' : ''}${
        field.componentKind === 'node_section'
          ? ' is-node-section'
          : field.componentKind === 'field' && field.contentType === 'equation'
            ? ' is-equation'
            : ''
      }`}
      style={{
        left: field.relativeX * scale,
        top: field.relativeY * scale,
        width: field.relativeWidth * scale,
        height: field.relativeHeight * scale,
        zIndex: field.zIndex + 1,
        backgroundColor: nodeSection
          ? 'rgba(248, 250, 252, 0.95)'
          : field.componentKind === 'field'
            ? (field.style.backgroundColor ?? '#fff')
            : '#fff',
        color:
          field.componentKind === 'field' ? field.style.color : '#0f172a',
        fontSize:
          field.componentKind === 'field'
            ? Math.max(10, field.style.fontSize * scale * 0.85)
            : Math.max(10, 12 * scale),
      }}
      onPointerDown={startDrag}
      role="button"
      tabIndex={0}
      aria-label={
        nodeSection ? `Node Section ${field.label}` : `Field ${field.label}`
      }
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
          {nodeSection
            ? 'NODE SECTION'
            : field.componentKind === 'field'
              ? field.contentType.toUpperCase()
              : ''}
          {field.required ? '' : ' · optional'}
        </span>
      </div>

      {nodeSection && previewLayout ? (
        <div className="structure-node-preview">
          <div
            className="structure-node-preview-canvas"
            style={{
              width: previewLayout.bounds.width * previewScale,
              height: previewLayout.bounds.height * previewScale,
            }}
          >
            {previewLayout.edges.map((edge) => {
              const parent = previewLayout.nodes.find(
                (n) => n.layoutKey === edge.parentKey,
              );
              const child = previewLayout.nodes.find(
                (n) => n.layoutKey === edge.childKey,
              );
              if (!parent || !child) return null;
              const x1 = (parent.x + parent.width / 2) * previewScale;
              const y1 = (parent.y + parent.height) * previewScale;
              const x2 = (child.x + child.width / 2) * previewScale;
              const y2 = child.y * previewScale;
              if (nodeSection.layoutMode === 'tree_horizontal') {
                // redraw for horizontal in SVG below via different coords
              }
              const hx1 =
                nodeSection.layoutMode === 'tree_horizontal'
                  ? (parent.x + parent.width) * previewScale
                  : x1;
              const hy1 =
                nodeSection.layoutMode === 'tree_horizontal'
                  ? (parent.y + parent.height / 2) * previewScale
                  : y1;
              const hx2 =
                nodeSection.layoutMode === 'tree_horizontal'
                  ? child.x * previewScale
                  : x2;
              const hy2 =
                nodeSection.layoutMode === 'tree_horizontal'
                  ? (child.y + child.height / 2) * previewScale
                  : y2;
              return (
                <svg
                  key={`${edge.parentKey}-${edge.childKey}`}
                  className="structure-node-preview-edge"
                  width="100%"
                  height="100%"
                >
                  <line
                    x1={hx1}
                    y1={hy1}
                    x2={hx2}
                    y2={hy2}
                    stroke={nodeSection.connectorConfig.color}
                    strokeWidth={1.5}
                  />
                </svg>
              );
            })}
            {previewLayout.nodes.map((n) => (
              <div
                key={n.layoutKey}
                className={`structure-node-preview-node${n.isRoot ? ' is-root' : ''}`}
                style={{
                  left: n.x * previewScale,
                  top: n.y * previewScale,
                  width: n.width * previewScale,
                  height: n.height * previewScale,
                  backgroundColor: n.isRoot
                    ? nodeSection.rootTemplate.style.backgroundColor ?? '#0f172a'
                    : nodeSection.childTemplate.style.backgroundColor ?? '#e2e8f0',
                  color: n.isRoot
                    ? nodeSection.rootTemplate.style.color
                    : nodeSection.childTemplate.style.color,
                  fontSize: Math.max(8, 10 * previewScale),
                }}
              >
                {n.content}
              </div>
            ))}
          </div>
          <div className="structure-field-box-instruction">
            {nodeSection.instruction}
          </div>
        </div>
      ) : (
        <div className="structure-field-box-instruction">{field.instruction}</div>
      )}

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
