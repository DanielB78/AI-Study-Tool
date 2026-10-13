/**
 * Native GraphElement annotation operations: legend, regions, curve labels.
 * Point annotation extends existing annotate_graph_point (upsert).
 */

import type { GraphElement } from '../../../types/canvas';
import { createId, touch } from '../../../utils/ids';
import {
  normalizeInterval,
  type GraphLegendVisibility,
  type GraphRegion,
  type GraphRegionType,
} from '../../graphs/types';
import { CanvasAgentParseError } from './parseErrors';

export type SetGraphLegendOperation = {
  type: 'set_graph_legend';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  visibility: GraphLegendVisibility;
};

export type SetGraphCurveLabelOperation = {
  type: 'set_graph_curve_label';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  expression_id: string;
  label: string;
};

export type GraphRegionSpec = {
  type: GraphRegionType;
  x_min: number;
  x_max: number;
  y_min?: number | null;
  y_max?: number | null;
  expression_id?: string;
  label?: string;
};

export type AddGraphRegionOperation = {
  type: 'add_graph_region';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  region: GraphRegionSpec;
};

export type UpdateGraphRegionOperation = {
  type: 'update_graph_region';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  region_id: string;
  label?: string;
  x_min?: number;
  x_max?: number;
  y_min?: number | null;
  y_max?: number | null;
  visible?: boolean;
};

export type RemoveGraphRegionOperation = {
  type: 'remove_graph_region';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  region_id: string;
};

export type GraphAnnotationOperation =
  | SetGraphLegendOperation
  | SetGraphCurveLabelOperation
  | AddGraphRegionOperation
  | UpdateGraphRegionOperation
  | RemoveGraphRegionOperation;

export const GRAPH_ANNOTATION_OPERATION_TYPES = [
  'set_graph_legend',
  'set_graph_curve_label',
  'add_graph_region',
  'update_graph_region',
  'remove_graph_region',
] as const;

export function isGraphAnnotationOperationType(
  t: string,
): t is GraphAnnotationOperation['type'] {
  return (GRAPH_ANNOTATION_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resolveTargets(raw: Record<string, unknown>): {
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
} {
  const id =
    typeof raw.target_element_id === 'string'
      ? raw.target_element_id.trim()
      : typeof raw.graph_id === 'string'
        ? raw.graph_id.trim()
        : typeof raw.target_id === 'string'
          ? raw.target_id.trim()
          : '';
  const ref =
    typeof raw.target_ref === 'string' ? raw.target_ref.trim() : '';
  if (!id && !ref) {
    throw new CanvasAgentParseError(
      'missing_target',
      'Graph annotation ops need target_element_id, graph_id, or target_ref.',
    );
  }
  return {
    ...(id ? { target_element_id: id, graph_id: id } : {}),
    ...(ref ? { target_ref: ref } : {}),
  };
}

function requireFinite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new CanvasAgentParseError('schema', `${field} must be a finite number.`);
  }
  return v;
}

export function parseGraphAnnotationOperation(
  raw: Record<string, unknown>,
): GraphAnnotationOperation {
  const type = raw.type;
  if (typeof type !== 'string' || !isGraphAnnotationOperationType(type)) {
    throw new CanvasAgentParseError('schema', 'Unknown graph annotation operation.');
  }
  const targets = resolveTargets(raw);

  if (type === 'set_graph_legend') {
    const visibility = raw.visibility ?? raw.mode;
    if (
      visibility !== 'auto' &&
      visibility !== 'show' &&
      visibility !== 'hide'
    ) {
      throw new CanvasAgentParseError(
        'schema',
        'set_graph_legend.visibility must be auto|show|hide.',
      );
    }
    return { type, ...targets, visibility };
  }

  if (type === 'set_graph_curve_label') {
    const expression_id =
      typeof raw.expression_id === 'string' ? raw.expression_id.trim() : '';
    if (!expression_id) {
      throw new CanvasAgentParseError(
        'schema',
        'set_graph_curve_label needs expression_id.',
      );
    }
    const label =
      typeof raw.label === 'string'
        ? raw.label.trim()
        : typeof raw.text === 'string'
          ? raw.text.trim()
          : '';
    if (!label) {
      throw new CanvasAgentParseError(
        'empty_text',
        'set_graph_curve_label needs a non-empty label.',
      );
    }
    return { type, ...targets, expression_id, label };
  }

  if (type === 'add_graph_region') {
    const regionRaw = isRecord(raw.region) ? raw.region : raw;
    const rType = regionRaw.type;
    if (
      rType !== 'x_interval' &&
      rType !== 'rectangle' &&
      rType !== 'curve_segment'
    ) {
      throw new CanvasAgentParseError(
        'schema',
        'region.type must be x_interval|rectangle|curve_segment.',
      );
    }
    const x_min = requireFinite(regionRaw.x_min ?? regionRaw.xMin, 'region.x_min');
    const x_max = requireFinite(regionRaw.x_max ?? regionRaw.xMax, 'region.x_max');
    if (x_min === x_max) {
      throw new CanvasAgentParseError(
        'schema',
        'region x_min and x_max must differ.',
      );
    }
    const region: GraphRegionSpec = {
      type: rType,
      x_min,
      x_max,
      label:
        typeof regionRaw.label === 'string' ? regionRaw.label.trim() : undefined,
    };
    if (rType === 'rectangle') {
      region.y_min = requireFinite(
        regionRaw.y_min ?? regionRaw.yMin,
        'region.y_min',
      );
      region.y_max = requireFinite(
        regionRaw.y_max ?? regionRaw.yMax,
        'region.y_max',
      );
      if (region.y_min === region.y_max) {
        throw new CanvasAgentParseError(
          'schema',
          'region y_min and y_max must differ.',
        );
      }
    }
    if (rType === 'curve_segment') {
      const expression_id =
        typeof regionRaw.expression_id === 'string'
          ? regionRaw.expression_id.trim()
          : '';
      if (!expression_id) {
        throw new CanvasAgentParseError(
          'schema',
          'curve_segment needs expression_id.',
        );
      }
      region.expression_id = expression_id;
    }
    return { type, ...targets, region };
  }

  if (type === 'update_graph_region') {
    const region_id =
      typeof raw.region_id === 'string' ? raw.region_id.trim() : '';
    if (!region_id) {
      throw new CanvasAgentParseError(
        'schema',
        'update_graph_region needs region_id.',
      );
    }
    return {
      type,
      ...targets,
      region_id,
      ...(typeof raw.label === 'string' ? { label: raw.label.trim() } : {}),
      ...(typeof raw.x_min === 'number' ? { x_min: raw.x_min } : {}),
      ...(typeof raw.x_max === 'number' ? { x_max: raw.x_max } : {}),
      ...(raw.y_min === null || typeof raw.y_min === 'number'
        ? { y_min: raw.y_min as number | null }
        : {}),
      ...(raw.y_max === null || typeof raw.y_max === 'number'
        ? { y_max: raw.y_max as number | null }
        : {}),
      ...(typeof raw.visible === 'boolean' ? { visible: raw.visible } : {}),
    };
  }

  const region_id =
    typeof raw.region_id === 'string' ? raw.region_id.trim() : '';
  if (!region_id) {
    throw new CanvasAgentParseError(
      'schema',
      'remove_graph_region needs region_id.',
    );
  }
  return { type: 'remove_graph_region', ...targets, region_id };
}

export function createGraphRegion(spec: GraphRegionSpec): GraphRegion {
  const ix = normalizeInterval(spec.x_min, spec.x_max);
  let yMin: number | null = null;
  let yMax: number | null = null;
  if (
    spec.type === 'rectangle' &&
    typeof spec.y_min === 'number' &&
    typeof spec.y_max === 'number'
  ) {
    const iy = normalizeInterval(spec.y_min, spec.y_max);
    yMin = iy.min;
    yMax = iy.max;
  }
  return {
    id: createId(),
    type: spec.type,
    xMin: ix.min,
    xMax: ix.max,
    yMin,
    yMax,
    expressionId: spec.expression_id ?? null,
    label: spec.label?.trim() ?? '',
    visible: true,
  };
}

export function applyGraphAnnotationOperation(
  graph: GraphElement,
  op: GraphAnnotationOperation,
): GraphElement {
  if (op.type === 'set_graph_legend') {
    return touch({
      ...graph,
      settings: {
        ...graph.settings,
        legendVisibility: op.visibility,
      },
    });
  }

  if (op.type === 'set_graph_curve_label') {
    const idx = graph.expressions.findIndex((e) => e.id === op.expression_id);
    if (idx < 0) {
      throw new Error(
        `Unknown expression_id "${op.expression_id}" on graph "${graph.id}".`,
      );
    }
    const expressions = graph.expressions.map((e, i) =>
      i === idx ? { ...e, label: op.label } : e,
    );
    return touch({ ...graph, expressions });
  }

  if (op.type === 'add_graph_region') {
    if (
      op.region.type === 'curve_segment' &&
      op.region.expression_id &&
      !graph.expressions.some((e) => e.id === op.region.expression_id)
    ) {
      throw new Error(
        `Unknown expression_id "${op.region.expression_id}" on graph "${graph.id}".`,
      );
    }
    // Avoid exact duplicates
    const ix = normalizeInterval(op.region.x_min, op.region.x_max);
    const dup = (graph.regions ?? []).find(
      (r) =>
        r.type === op.region.type &&
        r.xMin === ix.min &&
        r.xMax === ix.max &&
        (r.expressionId ?? null) === (op.region.expression_id ?? null) &&
        (op.region.type !== 'rectangle' ||
          (r.yMin ===
            (typeof op.region.y_min === 'number' &&
            typeof op.region.y_max === 'number'
              ? normalizeInterval(op.region.y_min, op.region.y_max).min
              : null) &&
            r.yMax ===
              (typeof op.region.y_min === 'number' &&
              typeof op.region.y_max === 'number'
                ? normalizeInterval(op.region.y_min, op.region.y_max).max
                : null))),
    );
    if (dup) return graph;
    const region = createGraphRegion(op.region);
    return touch({
      ...graph,
      regions: [...(graph.regions ?? []), region],
    });
  }

  if (op.type === 'update_graph_region') {
    const regions = (graph.regions ?? []).map((r) => {
      if (r.id !== op.region_id) return r;
      const next = { ...r };
      if (op.label !== undefined) next.label = op.label;
      if (op.x_min !== undefined || op.x_max !== undefined) {
        const ix = normalizeInterval(
          op.x_min ?? r.xMin,
          op.x_max ?? r.xMax,
        );
        next.xMin = ix.min;
        next.xMax = ix.max;
      }
      if (op.y_min !== undefined || op.y_max !== undefined) {
        if (op.y_min == null || op.y_max == null) {
          next.yMin = op.y_min ?? null;
          next.yMax = op.y_max ?? null;
        } else {
          const iy = normalizeInterval(op.y_min, op.y_max);
          next.yMin = iy.min;
          next.yMax = iy.max;
        }
      }
      if (op.visible !== undefined) next.visible = op.visible;
      return next;
    });
    if (!(graph.regions ?? []).some((r) => r.id === op.region_id)) {
      throw new Error(
        `Unknown region_id "${op.region_id}" on graph "${graph.id}".`,
      );
    }
    return touch({ ...graph, regions });
  }

  // remove_graph_region
  if (!(graph.regions ?? []).some((r) => r.id === op.region_id)) {
    throw new Error(
      `Unknown region_id "${op.region_id}" on graph "${graph.id}".`,
    );
  }
  return touch({
    ...graph,
    regions: (graph.regions ?? []).filter((r) => r.id !== op.region_id),
  });
}
