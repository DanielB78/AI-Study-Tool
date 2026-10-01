/**
 * NoteStructureInstantiationService — structure + field values → canvas elements.
 * LLM supplies content/hierarchy only; geometry comes from saved structure + layout.
 */

import type {
  CanvasElement,
  ConnectorElement,
  StyleDefaults,
  TextElement,
} from '../../types/canvas';
import { createAiTextElement } from '../ai/canvas/createAiTextElement';
import { createAiEquationElement } from '../ai/canvas/createAiEquationElement';
import { createId } from '../../utils/ids';
import { createBoundConnector } from './createBoundConnector';
import type { StructureFieldValue } from './fieldValues';
import { layoutNodeSectionHierarchy } from './nodeSectionLayout';
import type {
  NoteStructure,
  NoteStructureField,
  NoteStructureNodeSection,
  StructureComponent,
  StructureFieldStyle,
} from './types';
import { isNodeSection, isStructureField } from './types';

export interface StructurePlacementOrigin {
  x: number;
  y: number;
}

export interface InstantiateStructureInput {
  structure: NoteStructure;
  /** fieldId → value; omitted optional fields simply absent */
  fieldValues: ReadonlyMap<string, StructureFieldValue>;
  origin: StructurePlacementOrigin;
  style: StyleDefaults;
  nextZIndex: () => number;
  structureVersion?: number;
}

export interface InstantiateStructureResult {
  structureInstanceId: string;
  elements: CanvasElement[];
  createdFieldIds: string[];
  /** Effective bounds after expanding Node Sections (for placement). */
  bounds: { width: number; height: number };
}

function styleToTextOptions(fieldStyle: StructureFieldStyle, base: StyleDefaults) {
  return {
    ...base,
    fontSize: fieldStyle.fontSize,
    fontFamily: fieldStyle.fontFamily,
    fontWeight: fieldStyle.fontWeight,
    fontItalic: fieldStyle.fontItalic,
    underline: fieldStyle.underline,
    strikethrough: fieldStyle.strikethrough,
    textColor: fieldStyle.color,
    textAlignment: fieldStyle.alignment,
    lineHeight: fieldStyle.lineHeight,
    textBackgroundColor: fieldStyle.backgroundColor,
    textPadding: fieldStyle.padding,
    textCornerRadius: fieldStyle.cornerRadius,
  };
}

function instantiateFixedField(
  field: NoteStructureField,
  value: StructureFieldValue,
  origin: StructurePlacementOrigin,
  style: StyleDefaults,
  nextZIndex: () => number,
  metaBase: Record<string, unknown>,
): CanvasElement | null {
  const rect = {
    x: origin.x + field.relativeX,
    y: origin.y + field.relativeY,
    width: Math.max(24, field.relativeWidth),
    height: Math.max(24, field.relativeHeight),
  };
  const meta = {
    ...metaBase,
    structureFieldId: field.id,
    structureComponentId: field.id,
  };

  if (field.contentType === 'text' && value.kind === 'text') {
    const el = createAiTextElement(value.content, { x: rect.x, y: rect.y }, {
      zIndex: nextZIndex(),
      style: styleToTextOptions(field.style, style),
      width: rect.width,
      metadata: meta,
    });
    el.height = rect.height;
    return el;
  }
  if (field.contentType === 'equation' && value.kind === 'equation') {
    const el = createAiEquationElement(value.latex, { x: rect.x, y: rect.y }, {
      zIndex: nextZIndex(),
      style,
      fontSize: field.style.fontSize,
      color: field.style.color,
      metadata: meta,
    });
    el.width = rect.width;
    el.height = rect.height;
    return el;
  }
  return null;
}

function instantiateNodeSection(
  section: NoteStructureNodeSection,
  value: Extract<StructureFieldValue, { kind: 'node_section' }>,
  structureOrigin: StructurePlacementOrigin,
  style: StyleDefaults,
  nextZIndex: () => number,
  metaBase: Record<string, unknown>,
): { elements: CanvasElement[]; boundsWidth: number; boundsHeight: number } {
  const layout = layoutNodeSectionHierarchy(value.root, section);
  const sectionOrigin = {
    x: structureOrigin.x + section.relativeX,
    y: structureOrigin.y + section.relativeY,
  };

  const keyToElement = new Map<string, TextElement>();
  const elements: CanvasElement[] = [];

  for (const node of layout.nodes) {
    const template = node.isRoot ? section.rootTemplate : section.childTemplate;
    const nodeInstanceId = `node_${createId()}`;
    const parentEl = node.parentLayoutKey
      ? keyToElement.get(node.parentLayoutKey)
      : null;

    const el = createAiTextElement(
      node.content,
      { x: sectionOrigin.x + node.x, y: sectionOrigin.y + node.y },
      {
        zIndex: nextZIndex(),
        style: styleToTextOptions(template.style, style),
        width: node.width,
        metadata: {
          ...metaBase,
          structureComponentId: section.id,
          nodeSectionId: section.id,
          structureFieldId: section.id,
          nodeInstanceId,
          parentNodeElementId: parentEl?.id ?? null,
          depth: node.depth,
          childIndex: node.childIndex,
        },
      },
    );
    el.height = node.height;
    keyToElement.set(node.layoutKey, el);
    elements.push(el);
  }

  for (const edge of layout.edges) {
    const parent = keyToElement.get(edge.parentKey);
    const child = keyToElement.get(edge.childKey);
    if (!parent || !child) continue;
    const connector: ConnectorElement = createBoundConnector({
      parent: {
        id: parent.id,
        x: parent.x,
        y: parent.y,
        width: parent.width,
        height: parent.height,
      },
      child: {
        id: child.id,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      },
      layoutMode: section.layoutMode,
      style: section.connectorConfig,
      zIndex: nextZIndex(),
      metadata: {
        ...metaBase,
        structureComponentId: section.id,
        nodeSectionId: section.id,
        structureFieldId: section.id,
        relationshipType: 'parent_child',
      },
    });
    elements.push(connector);
  }

  return {
    elements,
    boundsWidth: section.relativeX + layout.bounds.width,
    boundsHeight: section.relativeY + layout.bounds.height,
  };
}

/**
 * Compute effective structure bounds after laying out Node Sections
 * (trees may expand beyond design-time placeholders).
 */
export function computeStructuredNoteBounds(
  structure: NoteStructure,
  fieldValues: ReadonlyMap<string, StructureFieldValue>,
): { width: number; height: number } {
  let width = structure.width;
  let height = structure.height;

  for (const component of structure.fields) {
    if (isStructureField(component)) {
      width = Math.max(width, component.relativeX + component.relativeWidth);
      height = Math.max(height, component.relativeY + component.relativeHeight);
      continue;
    }
    const value = fieldValues.get(component.id);
    if (!value || value.kind !== 'node_section') {
      width = Math.max(width, component.relativeX + component.relativeWidth);
      height = Math.max(height, component.relativeY + component.relativeHeight);
      continue;
    }
    const layout = layoutNodeSectionHierarchy(value.root, component);
    width = Math.max(width, component.relativeX + layout.bounds.width);
    height = Math.max(height, component.relativeY + layout.bounds.height);
  }

  return { width, height };
}

/**
 * Build canvas elements for populated fields / node sections.
 * Optional omitted fields create nothing. Does not rearrange remaining fields.
 */
export function instantiateNoteStructure(
  input: InstantiateStructureInput,
): InstantiateStructureResult {
  const structureInstanceId = `instance_${createId()}`;
  const elements: CanvasElement[] = [];
  const createdFieldIds: string[] = [];
  const metaBase = {
    structureId: input.structure.id,
    structureInstanceId,
    structureName: input.structure.name,
    structureVersion: input.structureVersion ?? input.structure.version,
    createdBy: 'ai',
    source: 'agent',
    operation: 'create_structured_note',
  };

  const sorted = [...input.structure.fields].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  );

  let boundsWidth = input.structure.width;
  let boundsHeight = input.structure.height;

  for (const component of sorted) {
    const value = input.fieldValues.get(component.id);
    if (!value) continue;

    if (isStructureField(component)) {
      const el = instantiateFixedField(
        component,
        value,
        input.origin,
        input.style,
        input.nextZIndex,
        metaBase,
      );
      if (el) {
        elements.push(el);
        createdFieldIds.push(component.id);
        boundsWidth = Math.max(
          boundsWidth,
          component.relativeX + component.relativeWidth,
        );
        boundsHeight = Math.max(
          boundsHeight,
          component.relativeY + component.relativeHeight,
        );
      }
    } else if (isNodeSection(component) && value.kind === 'node_section') {
      const result = instantiateNodeSection(
        component,
        value,
        input.origin,
        input.style,
        input.nextZIndex,
        metaBase,
      );
      elements.push(...result.elements);
      createdFieldIds.push(component.id);
      boundsWidth = Math.max(boundsWidth, result.boundsWidth);
      boundsHeight = Math.max(boundsHeight, result.boundsHeight);
    }
  }

  return {
    structureInstanceId,
    elements,
    createdFieldIds,
    bounds: { width: boundsWidth, height: boundsHeight },
  };
}

export function structureBoundsSize(structure: NoteStructure): {
  width: number;
  height: number;
} {
  return { width: structure.width, height: structure.height };
}

export function componentLabel(c: StructureComponent): string {
  return c.label;
}
