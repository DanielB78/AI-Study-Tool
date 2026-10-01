/**
 * Persist note structures outside CanvasDocument (cross-board library).
 * Migrates v1 flat fields (no componentKind) → v2 StructureComponent union.
 */

import type {
  NoteStructure,
  NoteStructureField,
  NoteStructureNodeSection,
  StructureComponent,
  StructureFieldStyle,
} from './types';
import {
  DEFAULT_CHILD_NODE_STYLE,
  DEFAULT_NODE_SECTION_MAX_DEPTH,
  DEFAULT_NODE_SECTION_MAX_TOTAL_NODES,
  DEFAULT_ROOT_NODE_STYLE,
  DEFAULT_STRUCTURE_FIELD_STYLE,
  NOTE_STRUCTURE_VERSION,
} from './types';

const STORAGE_KEY = 'ai-study-tool:note-structures:v1';

export interface NoteStructureLibrary {
  version: typeof NOTE_STRUCTURE_VERSION;
  structures: NoteStructure[];
}

function emptyLibrary(): NoteStructureLibrary {
  return { version: NOTE_STRUCTURE_VERSION, structures: [] };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function migrateStyle(raw: unknown): StructureFieldStyle {
  const s = isObject(raw) ? raw : {};
  return {
    ...DEFAULT_STRUCTURE_FIELD_STYLE,
    ...(typeof s.fontSize === 'number' ? { fontSize: s.fontSize } : {}),
    ...(typeof s.fontFamily === 'string' ? { fontFamily: s.fontFamily } : {}),
    ...(s.fontWeight === 'bold' || s.fontWeight === 'normal'
      ? { fontWeight: s.fontWeight }
      : {}),
    ...(typeof s.fontItalic === 'boolean' ? { fontItalic: s.fontItalic } : {}),
    ...(typeof s.underline === 'boolean' ? { underline: s.underline } : {}),
    ...(typeof s.strikethrough === 'boolean'
      ? { strikethrough: s.strikethrough }
      : {}),
    ...(typeof s.color === 'string' ? { color: s.color } : {}),
    ...(s.alignment === 'left' || s.alignment === 'center' || s.alignment === 'right'
      ? { alignment: s.alignment }
      : {}),
    ...(typeof s.lineHeight === 'number' ? { lineHeight: s.lineHeight } : {}),
    backgroundColor:
      s.backgroundColor === null || typeof s.backgroundColor === 'string'
        ? (s.backgroundColor as string | null)
        : DEFAULT_STRUCTURE_FIELD_STYLE.backgroundColor,
    ...(typeof s.padding === 'number' ? { padding: s.padding } : {}),
    ...(typeof s.cornerRadius === 'number' ? { cornerRadius: s.cornerRadius } : {}),
  };
}

function migrateField(raw: Record<string, unknown>): NoteStructureField | null {
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
  const contentType = raw.contentType === 'equation' ? 'equation' : 'text';
  return {
    componentKind: 'field',
    id: raw.id,
    label: raw.label,
    instruction: typeof raw.instruction === 'string' ? raw.instruction : '',
    contentType,
    required: raw.required !== false,
    relativeX: typeof raw.relativeX === 'number' ? raw.relativeX : 24,
    relativeY: typeof raw.relativeY === 'number' ? raw.relativeY : 24,
    relativeWidth: typeof raw.relativeWidth === 'number' ? raw.relativeWidth : 280,
    relativeHeight:
      typeof raw.relativeHeight === 'number' ? raw.relativeHeight : 100,
    zIndex: typeof raw.zIndex === 'number' ? raw.zIndex : 0,
    style: migrateStyle(raw.style),
  };
}

function migrateNodeTemplate(
  raw: unknown,
  fallback: { label: string; instruction: string; width: number; height: number; style: StructureFieldStyle },
) {
  const t = isObject(raw) ? raw : {};
  return {
    label: typeof t.label === 'string' ? t.label : fallback.label,
    instruction:
      typeof t.instruction === 'string' ? t.instruction : fallback.instruction,
    width: typeof t.width === 'number' ? t.width : fallback.width,
    height: typeof t.height === 'number' ? t.height : fallback.height,
    style: migrateStyle(t.style ?? fallback.style),
  };
}

function migrateNodeSection(
  raw: Record<string, unknown>,
): NoteStructureNodeSection | null {
  if (typeof raw.id !== 'string') return null;
  const connector = isObject(raw.connectorConfig) ? raw.connectorConfig : {};
  return {
    componentKind: 'node_section',
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label : 'Knowledge Tree',
    instruction:
      typeof raw.instruction === 'string'
        ? raw.instruction
        : 'Organise the subject into a hierarchy of major concepts and sub-concepts.',
    required: raw.required !== false,
    relativeX: typeof raw.relativeX === 'number' ? raw.relativeX : 24,
    relativeY: typeof raw.relativeY === 'number' ? raw.relativeY : 24,
    relativeWidth:
      typeof raw.relativeWidth === 'number' ? raw.relativeWidth : 480,
    relativeHeight:
      typeof raw.relativeHeight === 'number' ? raw.relativeHeight : 320,
    zIndex: typeof raw.zIndex === 'number' ? raw.zIndex : 0,
    rootTemplate: migrateNodeTemplate(raw.rootTemplate, {
      label: 'Root Topic',
      instruction: 'Give the main subject or central concept in a short phrase.',
      width: 200,
      height: 64,
      style: DEFAULT_ROOT_NODE_STYLE,
    }),
    childTemplate: migrateNodeTemplate(raw.childTemplate, {
      label: 'Concept Node',
      instruction:
        'Give a concise subtopic name and one short explanatory sentence.',
      width: 180,
      height: 72,
      style: DEFAULT_CHILD_NODE_STYLE,
    }),
    layoutMode:
      raw.layoutMode === 'tree_horizontal' ? 'tree_horizontal' : 'tree_vertical',
    horizontalSpacing:
      typeof raw.horizontalSpacing === 'number' ? raw.horizontalSpacing : 28,
    verticalSpacing:
      typeof raw.verticalSpacing === 'number' ? raw.verticalSpacing : 36,
    maxDepth:
      typeof raw.maxDepth === 'number'
        ? raw.maxDepth
        : DEFAULT_NODE_SECTION_MAX_DEPTH,
    maxTotalNodes:
      typeof raw.maxTotalNodes === 'number'
        ? raw.maxTotalNodes
        : DEFAULT_NODE_SECTION_MAX_TOTAL_NODES,
    maxChildrenPerNode:
      typeof raw.maxChildrenPerNode === 'number'
        ? raw.maxChildrenPerNode
        : undefined,
    connectorConfig: {
      connectorType:
        connector.connectorType === 'line' ? 'line' : 'arrow',
      strokeStyle:
        connector.strokeStyle === 'dashed' || connector.strokeStyle === 'dotted'
          ? connector.strokeStyle
          : 'solid',
      strokeWidth:
        typeof connector.strokeWidth === 'number' ? connector.strokeWidth : 2,
      color: typeof connector.color === 'string' ? connector.color : '#64748b',
      arrowHeads:
        connector.arrowHeads === 'none' ||
        connector.arrowHeads === 'both' ||
        connector.arrowHeads === 'end'
          ? connector.arrowHeads
          : 'end',
    },
  };
}

function migrateComponent(raw: unknown): StructureComponent | null {
  if (!isObject(raw)) return null;
  if (raw.componentKind === 'node_section' || raw.contentType === 'node_section') {
    return migrateNodeSection(raw);
  }
  // v1 fields had no componentKind
  if (
    raw.componentKind === 'field' ||
    raw.contentType === 'text' ||
    raw.contentType === 'equation' ||
    typeof raw.contentType === 'undefined'
  ) {
    // Heuristic: objects with rootTemplate are node sections even without kind
    if (isObject(raw.rootTemplate) || isObject(raw.childTemplate)) {
      return migrateNodeSection(raw);
    }
    return migrateField(raw);
  }
  return null;
}

function migrateStructure(raw: unknown): NoteStructure | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    return null;
  }
  if (!Array.isArray(raw.fields)) return null;
  const fields = raw.fields
    .map(migrateComponent)
    .filter((c): c is StructureComponent => c != null);
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    width: typeof raw.width === 'number' ? raw.width : 640,
    height: typeof raw.height === 'number' ? raw.height : 480,
    fields,
    version: NOTE_STRUCTURE_VERSION,
  };
}

export function serializeStructureLibrary(library: NoteStructureLibrary): string {
  return JSON.stringify({
    version: NOTE_STRUCTURE_VERSION,
    structures: library.structures,
  });
}

export function parseStructureLibrary(json: string): NoteStructureLibrary {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!isObject(raw) || !Array.isArray(raw.structures)) return emptyLibrary();
    const structures = raw.structures
      .map(migrateStructure)
      .filter((s): s is NoteStructure => s != null);
    return { version: NOTE_STRUCTURE_VERSION, structures };
  } catch {
    return emptyLibrary();
  }
}

export function loadStructureLibrary(): NoteStructureLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLibrary();
    return parseStructureLibrary(raw);
  } catch {
    return emptyLibrary();
  }
}

export function saveStructureLibrary(library: NoteStructureLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeStructureLibrary(library));
  } catch {
    // quota / private mode
  }
}

export { STORAGE_KEY as NOTE_STRUCTURE_STORAGE_KEY };
