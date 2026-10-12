/**
 * Validate grid / relationship-grid layout specs against create operations.
 */

import { GRID_LAYOUT_CONFIG } from './layout/gridConfig';
import { isGridCreatableOp } from './layout/measure';
import { topologicalOrder } from './layout/relationshipOptimiser';
import type {
  AnyLayoutSpec,
  CanvasOperation,
  GridLayoutItemSpec,
  GridLayoutSpec,
  Placement,
  RelationshipGridItemSpec,
  RelationshipGridLayoutSpec,
  SemanticRelationSpec,
  TopicSectionSpec,
} from './operations';
import { CanvasAgentParseError } from './parseErrors';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseExplicitGrid(
  raw: Record<string, unknown>,
  parsePlacement: (raw: unknown) => Placement,
): GridLayoutSpec {
  const columns = raw.columns;
  // Accept up to maxItems — dynamic max enforced by reflow.
  if (
    typeof columns !== 'number' ||
    !Number.isInteger(columns) ||
    columns < GRID_LAYOUT_CONFIG.minColumns ||
    columns > GRID_LAYOUT_CONFIG.maxItems
  ) {
    throw new CanvasAgentParseError(
      'schema',
      `layout.columns must be an integer from ${GRID_LAYOUT_CONFIG.minColumns} to ${GRID_LAYOUT_CONFIG.maxItems}.`,
    );
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new CanvasAgentParseError('schema', 'layout.items must be a non-empty array.');
  }
  if (raw.items.length > GRID_LAYOUT_CONFIG.maxItems) {
    throw new CanvasAgentParseError(
      'schema',
      `layout.items exceeds maximum of ${GRID_LAYOUT_CONFIG.maxItems}.`,
    );
  }

  const placement = parsePlacement(raw.placement);
  const items: GridLayoutItemSpec[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i];
    if (!isRecord(item)) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}] must be an object.`);
    }
    if (typeof item.ref !== 'string' || !item.ref.trim()) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}].ref must be a non-empty string.`);
    }
    if (typeof item.row !== 'number' || !Number.isInteger(item.row) || item.row < 0) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].row must be a non-negative integer.`,
      );
    }
    if (item.row >= GRID_LAYOUT_CONFIG.maxRows) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].row exceeds maximum of ${GRID_LAYOUT_CONFIG.maxRows - 1}.`,
      );
    }
    if (
      typeof item.column !== 'number' ||
      !Number.isInteger(item.column) ||
      item.column < 0
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].column must be a non-negative integer.`,
      );
    }
    const span = item.column_span === undefined ? 1 : item.column_span;
    if (typeof span !== 'number' || !Number.isInteger(span) || span < 1) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].column_span must be a positive integer.`,
      );
    }
    if (item.column + span > columns) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}] column ${item.column} + span ${span} exceeds grid width ${columns}.`,
      );
    }
    items.push({
      ref: item.ref.trim(),
      row: item.row,
      column: item.column,
      column_span: span === 1 ? undefined : span,
    });
  }

  return { type: 'grid', columns, placement, items };
}

function parseRelation(raw: unknown, path: string): SemanticRelationSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', `${path} must be an object.`);
  }
  if (typeof raw.ref !== 'string' || !raw.ref.trim()) {
    throw new CanvasAgentParseError('schema', `${path}.ref must be a non-empty string.`);
  }
  if (
    typeof raw.strength !== 'number' ||
    !Number.isFinite(raw.strength) ||
    raw.strength < 0 ||
    raw.strength > 1
  ) {
    throw new CanvasAgentParseError(
      'schema',
      `${path}.strength must be a finite number between 0 and 1.`,
    );
  }
  return { ref: raw.ref.trim(), strength: raw.strength };
}

function parseRelationshipGrid(
  raw: Record<string, unknown>,
  parsePlacement: (raw: unknown) => Placement,
): RelationshipGridLayoutSpec {
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new CanvasAgentParseError(
      'schema',
      'relationship_grid.sections must be a non-empty array.',
    );
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new CanvasAgentParseError(
      'schema',
      'relationship_grid.items must be a non-empty array.',
    );
  }
  if (raw.items.length > GRID_LAYOUT_CONFIG.maxItems) {
    throw new CanvasAgentParseError(
      'schema',
      `layout.items exceeds maximum of ${GRID_LAYOUT_CONFIG.maxItems}.`,
    );
  }

  let columns: number | undefined;
  if (raw.columns !== undefined) {
    if (
      typeof raw.columns !== 'number' ||
      !Number.isInteger(raw.columns) ||
      raw.columns < 1 ||
      raw.columns > GRID_LAYOUT_CONFIG.maxColumns
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `relationship_grid.columns must be an integer from 1 to ${GRID_LAYOUT_CONFIG.maxColumns}.`,
      );
    }
    columns = raw.columns;
  }

  const placement = parsePlacement(raw.placement);
  const sections: TopicSectionSpec[] = [];
  const sectionIds = new Set<string>();
  for (let i = 0; i < raw.sections.length; i++) {
    const s = raw.sections[i];
    if (!isRecord(s)) {
      throw new CanvasAgentParseError('schema', `sections[${i}] must be an object.`);
    }
    if (typeof s.id !== 'string' || !s.id.trim()) {
      throw new CanvasAgentParseError('schema', `sections[${i}].id must be a non-empty string.`);
    }
    if (typeof s.order !== 'number' || !Number.isInteger(s.order) || s.order < 0) {
      throw new CanvasAgentParseError(
        'schema',
        `sections[${i}].order must be a non-negative integer.`,
      );
    }
    const id = s.id.trim();
    if (sectionIds.has(id)) {
      throw new CanvasAgentParseError('schema', `Duplicate section id "${id}".`);
    }
    sectionIds.add(id);
    sections.push({
      id,
      order: s.order,
      ...(typeof s.title === 'string' ? { title: s.title } : {}),
    });
  }

  const items: RelationshipGridItemSpec[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i];
    if (!isRecord(item)) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}] must be an object.`);
    }
    if (typeof item.ref !== 'string' || !item.ref.trim()) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}].ref must be a non-empty string.`);
    }
    if (typeof item.section !== 'string' || !item.section.trim()) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].section must be a non-empty string.`,
      );
    }
    const section = item.section.trim();
    if (!sectionIds.has(section)) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].section "${section}" is not defined in layout.sections.`,
      );
    }

    let preferred_order: number | undefined;
    if (item.preferred_order !== undefined) {
      if (typeof item.preferred_order !== 'number' || !Number.isInteger(item.preferred_order)) {
        throw new CanvasAgentParseError(
          'schema',
          `layout.items[${i}].preferred_order must be an integer.`,
        );
      }
      preferred_order = item.preferred_order;
    }

    let requires: string[] | undefined;
    if (item.requires !== undefined) {
      if (!Array.isArray(item.requires)) {
        throw new CanvasAgentParseError('schema', `layout.items[${i}].requires must be an array.`);
      }
      requires = [];
      const seenReq = new Set<string>();
      for (let r = 0; r < item.requires.length; r++) {
        const req = item.requires[r];
        if (typeof req !== 'string' || !req.trim()) {
          throw new CanvasAgentParseError(
            'schema',
            `layout.items[${i}].requires[${r}] must be a non-empty string.`,
          );
        }
        const id = req.trim();
        if (id === item.ref.trim()) {
          throw new CanvasAgentParseError(
            'schema',
            `layout.items[${i}] cannot require itself.`,
          );
        }
        if (seenReq.has(id)) {
          throw new CanvasAgentParseError(
            'schema',
            `layout.items[${i}].requires has duplicate "${id}".`,
          );
        }
        seenReq.add(id);
        requires.push(id);
      }
    }

    let relations: SemanticRelationSpec[] | undefined;
    if (item.relations !== undefined) {
      if (!Array.isArray(item.relations)) {
        throw new CanvasAgentParseError('schema', `layout.items[${i}].relations must be an array.`);
      }
      if (item.relations.length > 3) {
        throw new CanvasAgentParseError(
          'schema',
          `layout.items[${i}].relations may have at most 3 entries.`,
        );
      }
      relations = [];
      const seenRel = new Set<string>();
      for (let r = 0; r < item.relations.length; r++) {
        const rel = parseRelation(item.relations[r], `layout.items[${i}].relations[${r}]`);
        if (rel.ref === item.ref.trim()) {
          throw new CanvasAgentParseError(
            'schema',
            `layout.items[${i}] cannot relate to itself.`,
          );
        }
        if (seenRel.has(rel.ref)) {
          throw new CanvasAgentParseError(
            'schema',
            `layout.items[${i}].relations has duplicate target "${rel.ref}".`,
          );
        }
        seenRel.add(rel.ref);
        relations.push(rel);
      }
    }

    let column_span: number | undefined;
    if (item.column_span !== undefined) {
      if (
        typeof item.column_span !== 'number' ||
        !Number.isInteger(item.column_span) ||
        item.column_span < 1
      ) {
        throw new CanvasAgentParseError(
          'schema',
          `layout.items[${i}].column_span must be a positive integer.`,
        );
      }
      column_span = item.column_span;
    }

    items.push({
      ref: item.ref.trim(),
      section,
      ...(preferred_order !== undefined ? { preferred_order } : {}),
      ...(requires ? { requires } : {}),
      ...(relations ? { relations } : {}),
      ...(column_span !== undefined ? { column_span } : {}),
    });
  }

  return {
    type: 'relationship_grid',
    placement,
    sections,
    items,
    ...(columns !== undefined ? { columns } : {}),
  };
}

/** Parse either explicit grid or relationship_grid. */
export function parseGridLayout(
  raw: unknown,
  parsePlacement: (raw: unknown) => Placement,
): AnyLayoutSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', 'layout must be an object.');
  }
  if (raw.type === 'grid') {
    return parseExplicitGrid(raw, parsePlacement);
  }
  if (raw.type === 'relationship_grid') {
    return parseRelationshipGrid(raw, parsePlacement);
  }
  throw new CanvasAgentParseError(
    'schema',
    'layout.type must be "grid" or "relationship_grid".',
    String(raw.type),
  );
}

function validateCreateRefs(
  layoutItems: ReadonlyArray<{ ref: string }>,
  operations: readonly CanvasOperation[],
): void {
  const creates = operations.filter(isGridCreatableOp);
  const createByRef = new Map<string, CanvasOperation>();
  for (const op of creates) {
    if (!op.ref) {
      throw new CanvasAgentParseError(
        'schema',
        `${op.type} is missing "ref" required by layout.items.`,
      );
    }
    if (createByRef.has(op.ref)) {
      throw new CanvasAgentParseError('schema', `Duplicate operation ref "${op.ref}".`);
    }
    createByRef.set(op.ref, op);
  }

  const assigned = new Set<string>();
  for (const item of layoutItems) {
    if (!createByRef.has(item.ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items references unknown ref "${item.ref}".`,
      );
    }
    if (assigned.has(item.ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items assigns ref "${item.ref}" more than once.`,
      );
    }
    assigned.add(item.ref);
  }

  for (const ref of createByRef.keys()) {
    if (!assigned.has(ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `Create operation ref "${ref}" is not assigned in layout.items.`,
      );
    }
  }
}

/**
 * Ensure refs/cells are valid and multi-create viewport_default plans use a grid.
 */
export function validateLayoutAgainstOperations(
  layout: AnyLayoutSpec | undefined,
  operations: readonly CanvasOperation[],
): void {
  const creates = operations.filter(isGridCreatableOp);

  if (!layout) {
    if (creates.length < 2) return;
    const allExplicit = creates.every(
      (c) => c.placement.mode === 'relative_to_element' || c.placement.mode === 'absolute',
    );
    if (allExplicit) return;
    throw new CanvasAgentParseError(
      'schema',
      'Multiple create operations require a grid "layout" (or explicit relative/absolute placement on each). Do not assign viewport_default to every object.',
    );
  }

  validateCreateRefs(layout.items, operations);

  if (layout.type === 'grid') {
    const occupied = new Set<string>();
    for (const item of layout.items) {
      const span = item.column_span ?? 1;
      for (let c = item.column; c < item.column + span; c++) {
        const key = `${item.row}:${c}`;
        if (occupied.has(key)) {
          throw new CanvasAgentParseError(
            'schema',
            `layout cell (${item.row}, ${c}) is occupied by more than one item.`,
          );
        }
        occupied.add(key);
      }
    }
    return;
  }

  // relationship_grid — validate relation/require refs + acyclic prerequisites
  const refs = new Set(layout.items.map((i) => i.ref));
  for (const item of layout.items) {
    for (const rel of item.relations ?? []) {
      if (!refs.has(rel.ref)) {
        throw new CanvasAgentParseError(
          'schema',
          `Item "${item.ref}" relation target "${rel.ref}" is not a created layout ref.`,
        );
      }
    }
    for (const req of item.requires ?? []) {
      if (!refs.has(req)) {
        throw new CanvasAgentParseError(
          'schema',
          `Item "${item.ref}" requires unknown ref "${req}".`,
        );
      }
    }
  }

  const requires = new Map<string, string[]>();
  for (const item of layout.items) {
    requires.set(item.ref, [...(item.requires ?? [])]);
  }
  try {
    topologicalOrder(
      layout.items.map((i) => i.ref),
      requires,
    );
  } catch (err) {
    throw new CanvasAgentParseError(
      'schema',
      err instanceof Error ? err.message : 'Invalid prerequisite graph.',
    );
  }
}
