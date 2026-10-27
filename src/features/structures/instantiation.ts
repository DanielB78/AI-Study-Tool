/**
 * Visual structure instantiation — template + slot values → canvas elements.
 * LLM supplies content only; geometry/styling come from the saved template.
 * Growing text pushes lower elements down without changing horizontal alignment.
 */

import type {
  CanvasElement,
  ConnectorElement,
  StyleDefaults,
  TextElement,
} from '../../types/canvas';
import { createAiTextElement } from '../ai/canvas/createAiTextElement';
import { createAiEquationElement } from '../ai/canvas/createAiEquationElement';
import { createAiGraphElement } from '../ai/canvas/createAiGraphElement';
import type { CreateGraphOperation } from '../ai/agent/operations';
import { createId } from '../../utils/ids';
import { TextElementAutoSizer } from '../text/textAutoSizer';
import type { RichTextDocument } from '../text/richText';
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
import { isDecorativeField, isNodeSection, isStructureField } from './types';

export interface StructurePlacementOrigin {
  x: number;
  y: number;
}

export interface InstantiateStructureInput {
  structure: NoteStructure;
  /** fieldId → value; omitted optional generative fields simply absent */
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
  /** Effective bounds after expanding slots / Node Sections (for placement). */
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

type PlannedSlot = {
  field: NoteStructureField;
  value: StructureFieldValue | null;
  relativeX: number;
  relativeY: number;
  width: number;
  height: number;
};

function measureTextSlotHeight(
  field: NoteStructureField,
  content: string,
  richText: RichTextDocument | undefined,
): number {
  const padding = Math.max(field.style.padding, 8);
  const measured = TextElementAutoSizer.measure({
    content: { text: content, richText },
    availableWidth: Math.max(24, field.relativeWidth),
    style: {
      fontSize: field.style.fontSize,
      fontFamily: field.style.fontFamily,
      fontWeight: field.style.fontWeight,
      fontItalic: field.style.fontItalic,
      underline: field.style.underline,
      lineHeight: field.style.lineHeight,
      color: field.style.color,
      padding,
    },
    autoSized: true,
  });
  // Never shrink below the template height; grow when content needs more room.
  return Math.max(field.relativeHeight, measured.height);
}

/**
 * Deterministic vertical reflow: when a slot grows taller than its template
 * height, push every slot whose top is at/below the grown slot's bottom down
 * by the delta. Horizontal positions stay fixed.
 */
function reflowVerticalGrowth(planned: PlannedSlot[]): PlannedSlot[] {
  const sorted = [...planned].sort(
    (a, b) =>
      a.relativeY - b.relativeY ||
      a.relativeX - b.relativeX ||
      a.field.id.localeCompare(b.field.id),
  );

  for (let i = 0; i < sorted.length; i++) {
    const slot = sorted[i]!;
    const templateBottom = slot.field.relativeY + slot.field.relativeHeight;
    const actualBottom = slot.relativeY + slot.height;
    const delta = actualBottom - templateBottom;
    if (delta <= 0.5) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const other = sorted[j]!;
      // Push elements that started at or below the grown slot's original bottom.
      if (other.field.relativeY >= templateBottom - 0.5) {
        other.relativeY += delta;
      }
    }
  }
  return sorted;
}

function buildPlannedSlots(
  structure: NoteStructure,
  fieldValues: ReadonlyMap<string, StructureFieldValue>,
): PlannedSlot[] {
  const planned: PlannedSlot[] = [];

  for (const component of structure.fields) {
    if (!isStructureField(component)) continue;

    let value: StructureFieldValue | null = fieldValues.get(component.id) ?? null;

    // Decorative: synthesise value from staticContent.
    if (isDecorativeField(component) && !value) {
      if (component.contentType === 'equation') {
        value = {
          kind: 'equation',
          latex: component.staticContent.trim() || component.label,
        };
      } else if (component.contentType === 'graph') {
        // Decorative graphs need a minimal expression; skip if empty.
        const expr = component.staticContent.trim() || 'x';
        value = {
          kind: 'graph',
          title: component.label,
          expressions: [expr],
          xMin: null,
          xMax: null,
          yMin: null,
          yMax: null,
          xLabel: null,
          yLabel: null,
        };
      } else {
        value = {
          kind: 'text',
          content: component.staticContent || component.label,
        };
      }
    }

    if (!value) continue;

    let height = component.relativeHeight;
    if (value.kind === 'text') {
      height = measureTextSlotHeight(
        component,
        value.content,
        value.richText as RichTextDocument | undefined,
      );
    }

    planned.push({
      field: component,
      value,
      relativeX: component.relativeX,
      relativeY: component.relativeY,
      width: Math.max(24, component.relativeWidth),
      height,
    });
  }

  return reflowVerticalGrowth(planned);
}

function instantiateFixedFieldAt(
  plan: PlannedSlot,
  origin: StructurePlacementOrigin,
  style: StyleDefaults,
  nextZIndex: () => number,
  metaBase: Record<string, unknown>,
): CanvasElement | null {
  const field = plan.field;
  const value = plan.value;
  if (!value) return null;

  const rect = {
    x: origin.x + plan.relativeX,
    y: origin.y + plan.relativeY,
    width: plan.width,
    height: plan.height,
  };
  const meta = {
    ...metaBase,
    structureFieldId: field.id,
    structureComponentId: field.id,
    structureSlotLabel: field.instruction || field.label,
    structureDecorative: isDecorativeField(field),
  };

  if (value.kind === 'text') {
    const el = createAiTextElement(value.content, { x: rect.x, y: rect.y }, {
      zIndex: nextZIndex(),
      style: styleToTextOptions(field.style, style),
      width: rect.width,
      richText: value.richText as RichTextDocument | undefined,
      metadata: meta,
    });
    el.height = rect.height;
    el.rotation = field.rotation ?? 0;
    // Preserve template colours/fonts — do not let generated markdown override.
    el.fontSize = field.style.fontSize;
    el.fontFamily = field.style.fontFamily;
    el.fontWeight = field.style.fontWeight;
    el.color = field.style.color;
    el.alignment = field.style.alignment;
    el.backgroundColor = field.style.backgroundColor;
    el.padding = field.style.padding;
    el.cornerRadius = field.style.cornerRadius;
    return el;
  }

  if (value.kind === 'equation') {
    const el = createAiEquationElement(value.latex, { x: rect.x, y: rect.y }, {
      zIndex: nextZIndex(),
      style,
      fontSize: field.style.fontSize,
      color: field.style.color,
      metadata: meta,
    });
    el.width = rect.width;
    el.height = rect.height;
    el.rotation = field.rotation ?? 0;
    return el;
  }

  if (value.kind === 'graph') {
    const op: CreateGraphOperation = {
      type: 'create_graph',
      expressions: value.expressions.map((expression) => ({
        expression,
        visible: true,
        domain_min: null,
        domain_max: null,
      })),
      points: [],
      viewport: {
        x_min: value.xMin ?? -10,
        x_max: value.xMax ?? 10,
        y_min: value.yMin ?? -10,
        y_max: value.yMax ?? 10,
      },
      settings: {
        title: value.title ?? '',
        x_axis_label: value.xLabel ?? '',
        y_axis_label: value.yLabel ?? '',
        show_grid: true,
        show_x_axis: true,
        show_y_axis: true,
      },
      placement: { mode: 'viewport_default' },
    };
    const el = createAiGraphElement(op, value.expressions, {
      x: rect.x,
      y: rect.y,
      zIndex: nextZIndex(),
      width: rect.width,
      height: rect.height,
      metadata: meta,
    });
    el.rotation = field.rotation ?? 0;
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
      childrenPlacement: section.childrenPlacement,
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
 * Compute effective structure bounds after laying out slots / Node Sections.
 */
export function computeStructuredNoteBounds(
  structure: NoteStructure,
  fieldValues: ReadonlyMap<string, StructureFieldValue>,
  _style?: StyleDefaults,
): { width: number; height: number } {
  void _style;
  const planned = buildPlannedSlots(structure, fieldValues);
  let width = structure.width;
  let height = structure.height;

  for (const plan of planned) {
    width = Math.max(width, plan.relativeX + plan.width);
    height = Math.max(height, plan.relativeY + plan.height);
  }

  for (const component of structure.fields) {
    if (!isNodeSection(component)) continue;
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
 * Build canvas elements for populated slots / decorative copies / legacy node sections.
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

  const planned = buildPlannedSlots(input.structure, input.fieldValues);

  let boundsWidth = input.structure.width;
  let boundsHeight = input.structure.height;

  const sortedPlans = [...planned].sort(
    (a, b) =>
      a.field.zIndex - b.field.zIndex || a.field.id.localeCompare(b.field.id),
  );

  for (const plan of sortedPlans) {
    const el = instantiateFixedFieldAt(
      plan,
      input.origin,
      input.style,
      input.nextZIndex,
      metaBase,
    );
    if (el) {
      elements.push(el);
      createdFieldIds.push(plan.field.id);
      boundsWidth = Math.max(boundsWidth, plan.relativeX + plan.width);
      boundsHeight = Math.max(boundsHeight, plan.relativeY + plan.height);
    }
  }

  // Legacy node sections (still supported for saved templates).
  const nodeSections = [...input.structure.fields]
    .filter(isNodeSection)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));

  for (const component of nodeSections) {
    const value = input.fieldValues.get(component.id);
    if (!value || value.kind !== 'node_section') continue;
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
