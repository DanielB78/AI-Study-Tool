/**
 * Graph context for LLM — structured GraphElement state only.
 *
 * Graphs have NO semantic embeddings. They enter context only via:
 *   - explicit_selection
 *   - spatial_neighbor
 *
 * Never serialize screenshots, sampled curves, ASTs, or inferred descriptions.
 */

import type { GraphElement } from '../../types/canvas';
import type {
  GraphExpression,
  GraphLegendVisibility,
  GraphPoint,
  GraphRegion,
  GraphSettings,
  GraphViewport,
} from '../graphs/types';

export interface GraphContextExpression {
  id: string;
  expression: string;
  label: string | null;
  visible: boolean;
  domain_min: number | null;
  domain_max: number | null;
}

export interface GraphContextPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  visible: boolean;
}

export interface GraphContextRegion {
  id: string;
  type: GraphRegion['type'];
  x_min: number;
  x_max: number;
  y_min: number | null;
  y_max: number | null;
  expression_id: string | null;
  label: string | null;
  visible: boolean;
}

export interface GraphContextViewport {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

export interface GraphContextSettings {
  title: string | null;
  x_axis_label: string | null;
  y_axis_label: string | null;
  show_grid: boolean;
  show_x_axis: boolean;
  show_y_axis: boolean;
  legend_visibility: GraphLegendVisibility;
}

export interface GraphContextWorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compact structured graph state for RAG/LLM context.
 * CanvasDocument GraphElement is the source of truth.
 */
export interface GraphContextItem {
  element_id: string;
  element_type: 'graph';
  expressions: GraphContextExpression[];
  points: GraphContextPoint[];
  regions: GraphContextRegion[];
  viewport: GraphContextViewport;
  settings: GraphContextSettings;
  world_bounds: GraphContextWorldBounds;
  /** Parent TextElement when this graph is an attached_graph. */
  associated_text_id?: string | null;
}

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t.length ? t : null;
}

function mapExpression(e: GraphExpression): GraphContextExpression {
  return {
    id: e.id,
    expression: e.sourceText,
    label: nullIfEmpty(e.label ?? ''),
    visible: e.visible,
    domain_min: e.domainMin,
    domain_max: e.domainMax,
  };
}

function mapPoint(p: GraphPoint): GraphContextPoint {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    label: p.label,
    visible: p.visible,
  };
}

function mapRegion(r: GraphRegion): GraphContextRegion {
  return {
    id: r.id,
    type: r.type,
    x_min: r.xMin,
    x_max: r.xMax,
    y_min: r.yMin,
    y_max: r.yMax,
    expression_id: r.expressionId,
    label: nullIfEmpty(r.label),
    visible: r.visible,
  };
}

function mapViewport(v: GraphViewport): GraphContextViewport {
  return {
    x_min: v.xMin,
    x_max: v.xMax,
    y_min: v.yMin,
    y_max: v.yMax,
  };
}

function mapSettings(s: GraphSettings): GraphContextSettings {
  return {
    title: nullIfEmpty(s.title),
    x_axis_label: nullIfEmpty(s.xAxisLabel),
    y_axis_label: nullIfEmpty(s.yAxisLabel),
    show_grid: s.showGrid,
    show_x_axis: s.showXAxis,
    show_y_axis: s.showYAxis,
    legend_visibility: s.legendVisibility ?? 'auto',
  };
}

/** Build GraphContextItem from a live GraphElement (no samples / no screenshots). */
export function toGraphContextItem(el: GraphElement): GraphContextItem {
  return {
    element_id: el.id,
    element_type: 'graph',
    expressions: el.expressions.map(mapExpression),
    points: el.points.map(mapPoint),
    regions: (el.regions ?? []).map(mapRegion),
    viewport: mapViewport(el.viewport),
    settings: mapSettings(el.settings),
    world_bounds: {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    },
    associated_text_id: el.association?.associatedElementId ?? null,
  };
}

function formatDomain(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'none';
  if (min != null && max != null) return `${min} to ${max}`;
  if (min != null) return `${min} to …`;
  return `… to ${max}`;
}

/**
 * Serialize graph structured state for LLM prompts / Preview Context.
 * Includes only user/agent-configured fields.
 */
export function formatGraphContextItem(
  item: GraphContextItem,
  options?: { includeWorldBounds?: boolean },
): string {
  const lines: string[] = [
    'GRAPH ELEMENT',
    '',
    `ID: ${item.element_id}`,
    'This graph is available for editing.',
  ];
  if (item.associated_text_id) {
    lines.push(`Associated TextElement: ${item.associated_text_id}`);
  }
  lines.push('', 'EXPRESSIONS:');

  if (item.expressions.length === 0) {
    lines.push('none');
  } else {
    for (const e of item.expressions) {
      lines.push('');
      lines.push(`- ID: ${e.id}`);
      lines.push(`  expression: ${e.expression}`);
      if (e.label) lines.push(`  label: ${e.label}`);
      lines.push(`  visible: ${e.visible}`);
      lines.push(`  domain: ${formatDomain(e.domain_min, e.domain_max)}`);
    }
  }

  lines.push('');
  lines.push('VIEWPORT:');
  lines.push(`x_min: ${item.viewport.x_min}`);
  lines.push(`x_max: ${item.viewport.x_max}`);
  lines.push(`y_min: ${item.viewport.y_min}`);
  lines.push(`y_max: ${item.viewport.y_max}`);

  lines.push('');
  lines.push('POINTS:');
  if (item.points.length === 0) {
    lines.push('none');
  } else {
    for (const p of item.points) {
      lines.push(
        `- ID: ${p.id}  (${p.x}, ${p.y})${p.label ? `  label: ${p.label}` : ''}  visible: ${p.visible}`,
      );
    }
  }

  lines.push('');
  lines.push('REGIONS:');
  if (item.regions.length === 0) {
    lines.push('none');
  } else {
    for (const r of item.regions) {
      const yPart =
        r.y_min != null && r.y_max != null
          ? ` y=[${r.y_min}, ${r.y_max}]`
          : '';
      const exprPart = r.expression_id ? ` expression_id=${r.expression_id}` : '';
      lines.push(
        `- ID: ${r.id}  type=${r.type}  x=[${r.x_min}, ${r.x_max}]${yPart}${exprPart}${r.label ? `  label: ${r.label}` : ''}  visible: ${r.visible}`,
      );
    }
  }

  lines.push('');
  lines.push('SETTINGS:');
  lines.push(`title: ${item.settings.title === null ? 'null' : JSON.stringify(item.settings.title)}`);
  lines.push(
    `x_axis_label: ${item.settings.x_axis_label === null ? 'null' : JSON.stringify(item.settings.x_axis_label)}`,
  );
  lines.push(
    `y_axis_label: ${item.settings.y_axis_label === null ? 'null' : JSON.stringify(item.settings.y_axis_label)}`,
  );
  lines.push(`show_grid: ${item.settings.show_grid}`);
  lines.push(`show_x_axis: ${item.settings.show_x_axis}`);
  lines.push(`show_y_axis: ${item.settings.show_y_axis}`);
  lines.push(`legend_visibility: ${item.settings.legend_visibility}`);

  if (options?.includeWorldBounds) {
    lines.push('');
    lines.push('WORLD BOUNDS:');
    lines.push(`x: ${item.world_bounds.x}`);
    lines.push(`y: ${item.world_bounds.y}`);
    lines.push(`width: ${item.world_bounds.width}`);
    lines.push(`height: ${item.world_bounds.height}`);
  }

  return lines.join('\n');
}

export function formatGraphElementForContext(el: GraphElement): string {
  return formatGraphContextItem(toGraphContextItem(el));
}

/** Compact one-line summary for debug lists (not for LLM). */
export function summarizeGraphForDebug(el: GraphElement): string {
  const curves =
    el.expressions.length === 0
      ? 'no curves'
      : el.expressions.map((e) => e.sourceText || '(empty)').join(', ');
  return `Curves: ${curves}`;
}
