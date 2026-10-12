import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NoteStructureNodeSection } from '../types';
import { childrenPlacementLabel } from '../types';
import {
  layoutNodeSectionHierarchy,
  previewHierarchyForSection,
} from '../nodeSectionLayout';
import { StructureNodeTemplateBox } from './StructureNodeTemplateBox';
import { StructureConnectorPreview } from './StructureConnectorPreview';

interface StructureNodeSectionBoxProps {
  section: NoteStructureNodeSection;
  scale: number;
  selected: boolean;
  selectedTemplatePart: 'root' | 'child' | null;
  readOnly?: boolean;
  onSelectSection: () => void;
  onSelectTemplate: (part: 'root' | 'child') => void;
  onSectionGeometryChange: (geom: {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
  }) => void;
  onTemplateGeometryChange: (
    part: 'root' | 'child',
    geom: { relativeX: number; relativeY: number; width: number; height: number },
  ) => void;
}

function attachmentForPlacement(
  parent: { x: number; y: number; width: number; height: number },
  child: { x: number; y: number; width: number; height: number },
  placement: NoteStructureNodeSection['childrenPlacement'],
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
  const pcx = parent.x + parent.width / 2;
  const pcy = parent.y + parent.height / 2;
  const ccx = child.x + child.width / 2;
  const ccy = child.y + child.height / 2;
  const dx = ccx - pcx;
  const dy = ccy - pcy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x1: dx >= 0 ? parent.x + parent.width : parent.x,
      y1: pcy,
      x2: dx >= 0 ? child.x : child.x + child.width,
      y2: ccy,
    };
  }
  return {
    x1: pcx,
    y1: dy >= 0 ? parent.y + parent.height : parent.y,
    x2: ccx,
    y2: dy >= 0 ? child.y : child.y + child.height,
  };
}

/**
 * Node Section in the structure editor: region + real interactive root/child
 * textbox templates + connector-style preview + read-only placement clones.
 */
export function StructureNodeSectionBox({
  section,
  scale,
  selected,
  selectedTemplatePart,
  readOnly,
  onSelectSection,
  onSelectTemplate,
  onSectionGeometryChange,
  onTemplateGeometryChange,
}: StructureNodeSectionBoxProps) {
  const startRegionDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('.structure-node-template')) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectSection();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = {
      x: section.relativeX,
      y: section.relativeY,
      w: section.relativeWidth,
      h: section.relativeHeight,
    };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onSectionGeometryChange({
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

  const startRegionResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectSection();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = {
      x: section.relativeX,
      y: section.relativeY,
      w: section.relativeWidth,
      h: section.relativeHeight,
    };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onSectionGeometryChange({
        relativeX: orig.x,
        relativeY: orig.y,
        relativeWidth: Math.max(200, Math.round(orig.w + dx)),
        relativeHeight: Math.max(160, Math.round(orig.h + dy)),
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

  // Layout preview clones from placement mode (read-only).
  const preview = layoutNodeSectionHierarchy(
    previewHierarchyForSection(section.childrenPlacement),
    section,
  );

  // Coordinates inside the region are relative to the section origin.
  const rootLocal = {
    x: section.rootTemplate.relativeX,
    y: section.rootTemplate.relativeY,
  };
  const childLocal = {
    x: section.childTemplate.relativeX,
    y: section.childTemplate.relativeY,
  };

  const primaryConnector = attachmentForPlacement(
    {
      x: rootLocal.x,
      y: rootLocal.y,
      width: section.rootTemplate.width,
      height: section.rootTemplate.height,
    },
    {
      x: childLocal.x,
      y: childLocal.y,
      width: section.childTemplate.width,
      height: section.childTemplate.height,
    },
    section.childrenPlacement,
  );

  // Extra preview clones: layout nodes except root + first depth-1 child
  // (editable child template represents the primary child).
  const cloneNodes = preview.nodes.filter(
    (n) => !(n.isRoot || (n.depth === 1 && n.childIndex === 0)),
  );
  const cloneKeys = new Set(cloneNodes.map((n) => n.layoutKey));
  const cloneEdges = preview.edges.filter(
    (e) => cloneKeys.has(e.childKey) || cloneKeys.has(e.parentKey),
  );

  return (
    <div
      className={`structure-node-section-region${selected ? ' is-selected' : ''}`}
      style={{
        left: section.relativeX * scale,
        top: section.relativeY * scale,
        width: section.relativeWidth * scale,
        height: section.relativeHeight * scale,
        zIndex: section.zIndex + 1,
      }}
      onPointerDown={startRegionDrag}
    >
      <div className="structure-node-section-header">
        <strong>{section.label}</strong>
        <span>NODE SECTION · {childrenPlacementLabel(section.childrenPlacement)}</span>
      </div>
      <p className="structure-node-section-hint">
        Design-time templates show AI instructions. Generated output = TextElements +
        ConnectorElements — never an image.
      </p>

      <div className="structure-node-section-clones" aria-hidden>
        {cloneEdges.map((edge) => {
          const parent = preview.nodes.find((n) => n.layoutKey === edge.parentKey);
          const child = preview.nodes.find((n) => n.layoutKey === edge.childKey);
          if (!parent || !child) return null;
          // Map layout root → editable root local position for clone edges from root.
          const parentBox = parent.isRoot
            ? {
                x: rootLocal.x,
                y: rootLocal.y,
                width: section.rootTemplate.width,
                height: section.rootTemplate.height,
              }
            : {
                x: parent.x,
                y: parent.y,
                width: parent.width,
                height: parent.height,
              };
          const pts = attachmentForPlacement(
            parentBox,
            {
              x: child.x,
              y: child.y,
              width: child.width,
              height: child.height,
            },
            section.childrenPlacement,
          );
          return (
            <StructureConnectorPreview
              key={`${edge.parentKey}-${edge.childKey}`}
              {...pts}
              scale={scale}
              config={section.connectorConfig}
            />
          );
        })}
        {cloneNodes.map((n) => (
          <StructureNodeTemplateBox
            key={n.layoutKey}
            template={{
              ...section.childTemplate,
              label: n.content,
              instruction: section.childTemplate.instruction,
              relativeX: n.x,
              relativeY: n.y,
              width: n.width,
              height: n.height,
            }}
            absX={n.x}
            absY={n.y}
            scale={scale}
            selected={false}
            role="child"
            isPreviewClone
            readOnly
            onSelect={() => undefined}
            templateRelative={{ relativeX: n.x, relativeY: n.y }}
          />
        ))}
      </div>

      <StructureConnectorPreview
        {...primaryConnector}
        scale={scale}
        config={section.connectorConfig}
      />

      <StructureNodeTemplateBox
        template={section.rootTemplate}
        absX={rootLocal.x}
        absY={rootLocal.y}
        scale={scale}
        selected={selected && selectedTemplatePart === 'root'}
        role="root"
        readOnly={readOnly}
        onSelect={() => onSelectTemplate('root')}
        onGeometryChange={(geom) => onTemplateGeometryChange('root', geom)}
        templateRelative={{
          relativeX: section.rootTemplate.relativeX,
          relativeY: section.rootTemplate.relativeY,
        }}
      />

      <StructureNodeTemplateBox
        template={section.childTemplate}
        absX={childLocal.x}
        absY={childLocal.y}
        scale={scale}
        selected={selected && selectedTemplatePart === 'child'}
        role="child"
        readOnly={readOnly}
        onSelect={() => onSelectTemplate('child')}
        onGeometryChange={(geom) => onTemplateGeometryChange('child', geom)}
        templateRelative={{
          relativeX: section.childTemplate.relativeX,
          relativeY: section.childTemplate.relativeY,
        }}
      />

      {!readOnly && selected && (
        <span
          className="structure-field-resize"
          onPointerDown={startRegionResize}
          aria-hidden
        />
      )}
    </div>
  );
}
