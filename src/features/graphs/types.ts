/**
 * Graph element domain types (persisted on GraphElement).
 * Parsed ASTs are NOT stored — only source text.
 */

export interface GraphViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GraphExpressionStyle {
  color: string;
  strokeWidth: number;
}

export interface GraphExpression {
  id: string;
  /**
   * Canonical GraphMathSyntax source (persisted / AI), e.g. "sin(x) + x**2".
   * Not LaTeX. Not mathjs-native `^`. Parser-specific forms are transient.
   */
  sourceText: string;
  visible: boolean;
  domainMin: number | null;
  domainMax: number | null;
  style: GraphExpressionStyle;
}

export interface GraphPoint {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  label: string;
  color: string;
}

export interface GraphSettings {
  showGrid: boolean;
  showXAxis: boolean;
  showYAxis: boolean;
  xAxisLabel: string;
  yAxisLabel: string;
  title: string;
}

export const DEFAULT_GRAPH_VIEWPORT: GraphViewport = {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
  xAxisLabel: '',
  yAxisLabel: '',
  title: '',
};

export const DEFAULT_GRAPH_WIDTH = 600;
export const DEFAULT_GRAPH_HEIGHT = 400;

/** Distinct series colours for multiple expressions. */
export const GRAPH_EXPRESSION_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#059669', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#4f46e5', // indigo
] as const;

export function nextExpressionColor(index: number): string {
  return GRAPH_EXPRESSION_COLORS[index % GRAPH_EXPRESSION_COLORS.length]!;
}

export function isValidViewport(v: GraphViewport): boolean {
  return (
    Number.isFinite(v.xMin) &&
    Number.isFinite(v.xMax) &&
    Number.isFinite(v.yMin) &&
    Number.isFinite(v.yMax) &&
    v.xMin < v.xMax &&
    v.yMin < v.yMax
  );
}
