import { createId, now } from '../../utils/ids';
import {
  DEFAULT_CHILD_NODE_STYLE,
  DEFAULT_NODE_CONNECTOR_CONFIG,
  DEFAULT_NODE_SECTION_MAX_DEPTH,
  DEFAULT_NODE_SECTION_MAX_TOTAL_NODES,
  DEFAULT_ROOT_NODE_STYLE,
  DEFAULT_STRUCTURE_FIELD_STYLE,
  DEFAULT_STRUCTURE_HEIGHT,
  DEFAULT_STRUCTURE_WIDTH,
  NOTE_STRUCTURE_VERSION,
  type NoteStructure,
  type NoteStructureField,
  type NoteStructureNodeSection,
  type NodeTemplate,
  type StructureComponent,
  type StructureFieldContentType,
  type StructureFieldStyle,
} from './types';

export function createEmptyStructure(name: string): NoteStructure {
  const t = now();
  return {
    id: `structure_${createId()}`,
    name: name.trim() || 'Untitled structure',
    createdAt: t,
    updatedAt: t,
    width: DEFAULT_STRUCTURE_WIDTH,
    height: DEFAULT_STRUCTURE_HEIGHT,
    fields: [],
    version: NOTE_STRUCTURE_VERSION,
  };
}

export function createStructureField(
  partial: Partial<NoteStructureField> & {
    label: string;
    instruction: string;
    contentType?: StructureFieldContentType;
  },
): NoteStructureField {
  return {
    componentKind: 'field',
    id: partial.id ?? `field_${createId()}`,
    label: partial.label,
    instruction: partial.instruction,
    contentType: partial.contentType ?? 'text',
    required: partial.required ?? true,
    relativeX: partial.relativeX ?? 24,
    relativeY: partial.relativeY ?? 24,
    relativeWidth: partial.relativeWidth ?? 280,
    relativeHeight: partial.relativeHeight ?? 100,
    zIndex: partial.zIndex ?? 0,
    style: { ...DEFAULT_STRUCTURE_FIELD_STYLE, ...(partial.style ?? {}) },
  };
}

export function createNodeTemplate(
  partial: Partial<NodeTemplate> & { label: string; instruction: string },
  defaults: {
    width: number;
    height: number;
    style: StructureFieldStyle;
    relativeX?: number;
    relativeY?: number;
  },
): NodeTemplate {
  return {
    label: partial.label,
    instruction: partial.instruction,
    width: partial.width ?? defaults.width,
    height: partial.height ?? defaults.height,
    relativeX: partial.relativeX ?? defaults.relativeX ?? 24,
    relativeY: partial.relativeY ?? defaults.relativeY ?? 24,
    style: { ...defaults.style, ...(partial.style ?? {}) },
  };
}

export function createNodeSection(
  partial: Partial<NoteStructureNodeSection> & {
    label?: string;
    instruction?: string;
  } = {},
): NoteStructureNodeSection {
  const relativeWidth = partial.relativeWidth ?? 480;
  const relativeHeight = partial.relativeHeight ?? 320;
  return {
    componentKind: 'node_section',
    id: partial.id ?? `nodesection_${createId()}`,
    label: partial.label ?? 'Knowledge Tree',
    instruction:
      partial.instruction ??
      'Organise the subject into a hierarchy of major concepts and sub-concepts.',
    required: partial.required ?? true,
    relativeX: partial.relativeX ?? 24,
    relativeY: partial.relativeY ?? 24,
    relativeWidth,
    relativeHeight,
    zIndex: partial.zIndex ?? 0,
    rootTemplate:
      partial.rootTemplate ??
      createNodeTemplate(
        {
          label: 'Root Topic',
          instruction: 'Give the main subject or central concept in a short phrase.',
          relativeX: Math.round(relativeWidth / 2 - 100),
          relativeY: 24,
        },
        {
          width: 200,
          height: 72,
          style: DEFAULT_ROOT_NODE_STYLE,
          relativeX: Math.round(relativeWidth / 2 - 100),
          relativeY: 24,
        },
      ),
    childTemplate:
      partial.childTemplate ??
      createNodeTemplate(
        {
          label: 'Concept Node',
          instruction:
            'Give a concise concept name and short explanation.',
          relativeX: Math.round(relativeWidth / 2 - 90),
          relativeY: 140,
        },
        {
          width: 180,
          height: 80,
          style: DEFAULT_CHILD_NODE_STYLE,
          relativeX: Math.round(relativeWidth / 2 - 90),
          relativeY: 140,
        },
      ),
    childrenPlacement: partial.childrenPlacement ?? 'below',
    horizontalSpacing: partial.horizontalSpacing ?? 28,
    verticalSpacing: partial.verticalSpacing ?? 36,
    maxDepth: partial.maxDepth ?? DEFAULT_NODE_SECTION_MAX_DEPTH,
    maxTotalNodes: partial.maxTotalNodes ?? DEFAULT_NODE_SECTION_MAX_TOTAL_NODES,
    maxChildrenPerNode: partial.maxChildrenPerNode,
    connectorConfig: {
      ...DEFAULT_NODE_CONNECTOR_CONFIG,
      ...(partial.connectorConfig ?? {}),
    },
  };
}

/** Seed "Concept Summary" layout used in tests / demos. */
export function createConceptSummaryStructure(): NoteStructure {
  const base = createEmptyStructure('Concept Summary');
  base.description = 'Title, explanation, optional equation and example.';
  base.width = 720;
  base.height = 520;
  const style = (overrides: Partial<StructureFieldStyle> = {}): StructureFieldStyle => ({
    ...DEFAULT_STRUCTURE_FIELD_STYLE,
    ...overrides,
  });
  base.fields = [
    createStructureField({
      id: 'title',
      label: 'Concept title',
      instruction: 'Give a short title naming the concept.',
      contentType: 'text',
      required: true,
      relativeX: 16,
      relativeY: 16,
      relativeWidth: 688,
      relativeHeight: 64,
      zIndex: 0,
      style: style({ fontSize: 22, fontWeight: 'bold' }),
    }),
    createStructureField({
      id: 'explanation',
      label: 'Explanation',
      instruction: 'Explain the central idea clearly in 2–3 sentences.',
      contentType: 'text',
      required: true,
      relativeX: 16,
      relativeY: 96,
      relativeWidth: 688,
      relativeHeight: 180,
      zIndex: 1,
    }),
    createStructureField({
      id: 'equation',
      label: 'Equation',
      instruction:
        'Provide the most important equation associated with the concept, if one is useful.',
      contentType: 'equation',
      required: false,
      relativeX: 16,
      relativeY: 292,
      relativeWidth: 336,
      relativeHeight: 200,
      zIndex: 2,
    }),
    createStructureField({
      id: 'example',
      label: 'Example',
      instruction: 'Give one concise example demonstrating the concept.',
      contentType: 'text',
      required: false,
      relativeX: 368,
      relativeY: 292,
      relativeWidth: 336,
      relativeHeight: 200,
      zIndex: 3,
    }),
  ];
  return base;
}

/** Seed knowledge-tree structure for demos / tests. */
export function createKnowledgeTreeStructure(): NoteStructure {
  const base = createEmptyStructure('Knowledge Tree');
  base.description = 'Hierarchical concept tree with automatic connectors.';
  base.width = 720;
  base.height = 560;
  base.fields = [
    createNodeSection({
      id: 'knowledge_tree',
      label: 'Knowledge Tree',
      instruction: 'Break the subject into major ideas and their sub-concepts.',
      relativeX: 24,
      relativeY: 24,
      relativeWidth: 672,
      relativeHeight: 512,
      childrenPlacement: 'below',
      maxDepth: 4,
      maxTotalNodes: 30,
      rootTemplate: createNodeTemplate(
        {
          label: 'Root Topic',
          instruction: 'Main subject',
          width: 220,
          height: 70,
          relativeX: 226,
          relativeY: 24,
        },
        {
          width: 220,
          height: 70,
          style: DEFAULT_ROOT_NODE_STYLE,
          relativeX: 226,
          relativeY: 24,
        },
      ),
      childTemplate: createNodeTemplate(
        {
          label: 'Concept Node',
          instruction: 'Sub-concept with a concise explanation',
          width: 190,
          height: 80,
          relativeX: 241,
          relativeY: 140,
        },
        {
          width: 190,
          height: 80,
          style: DEFAULT_CHILD_NODE_STYLE,
          relativeX: 241,
          relativeY: 140,
        },
      ),
    }),
  ];
  return base;
}

export function duplicateStructure(structure: NoteStructure): NoteStructure {
  const t = now();
  return {
    ...structuredClone(structure),
    id: `structure_${createId()}`,
    name: `${structure.name} copy`,
    createdAt: t,
    updatedAt: t,
    version: NOTE_STRUCTURE_VERSION,
    fields: structure.fields.map((f) => {
      if (f.componentKind === 'node_section') {
        return {
          ...structuredClone(f),
          id: `nodesection_${createId()}`,
        } satisfies NoteStructureNodeSection;
      }
      return {
        ...structuredClone(f),
        id: `field_${createId()}`,
      } satisfies NoteStructureField;
    }),
  };
}

export function duplicateComponent(component: StructureComponent): StructureComponent {
  if (component.componentKind === 'node_section') {
    return {
      ...structuredClone(component),
      id: `nodesection_${createId()}`,
      label: `${component.label} copy`,
      relativeX: component.relativeX + 20,
      relativeY: component.relativeY + 20,
    };
  }
  return {
    ...structuredClone(component),
    id: `field_${createId()}`,
    label: `${component.label} copy`,
    relativeX: component.relativeX + 20,
    relativeY: component.relativeY + 20,
  };
}
