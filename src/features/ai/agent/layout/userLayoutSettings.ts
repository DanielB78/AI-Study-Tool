/**
 * User-configurable AI chronological layout preferences.
 *
 * The LLM emits content in reading order; these settings control how the app
 * packs measured Text / Equation / Graph elements onto the canvas.
 *
 * Persisted in localStorage (app preference, not document content) so changing
 * them never rearranges existing boards.
 */

export type ChronologicalDirection = 'down' | 'sideways';

/** Target columns:rows shape, e.g. { columns: 2, rows: 1 } → ~twice as many columns as rows. */
export type ColumnRowRatio = {
  columns: number;
  rows: number;
};

export type UserLayoutSettings = {
  chronologicalDirection: ChronologicalDirection;
  /** World-space max column height, or null = No limit. */
  maxColumnHeight: number | null;
  /** World-space max row / group width, or null = No limit. */
  maxRowWidth: number | null;
  /**
   * Target columns:rows aspect for the packed group, or null = no ratio
   * preference (pack only by direction + hard limits).
   */
  columnRowRatio: ColumnRowRatio | null;
};

export const DEFAULT_USER_LAYOUT_SETTINGS: UserLayoutSettings = {
  chronologicalDirection: 'down',
  maxColumnHeight: null,
  maxRowWidth: null,
  columnRowRatio: null,
};

/** Suggested values when the user turns a limit on. */
export const DEFAULT_LIMIT_SUGGESTIONS = {
  maxColumnHeight: 900,
  maxRowWidth: 1200,
} as const;

/** Common Columns:Rows presets shown in the UI. */
export const COLUMN_ROW_RATIO_PRESETS: readonly ColumnRowRatio[] = [
  { columns: 1, rows: 1 },
  { columns: 2, rows: 1 },
  { columns: 3, rows: 1 },
  { columns: 3, rows: 2 },
  { columns: 1, rows: 2 },
  { columns: 2, rows: 3 },
] as const;

const STORAGE_KEY = 'ai-study-tool:user-layout-settings:v1';

type Listener = () => void;

let current: UserLayoutSettings = loadFromStorage();
const listeners = new Set<Listener>();

function isPositiveLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1;
}

export function normalizeColumnRowRatio(
  raw: Partial<ColumnRowRatio> | null | undefined,
): ColumnRowRatio | null {
  if (raw == null) return null;
  const columns = raw.columns;
  const rows = raw.rows;
  if (!isPositiveInt(columns) || !isPositiveInt(rows)) return null;
  return {
    columns: Math.floor(columns),
    rows: Math.floor(rows),
  };
}

export function formatColumnRowRatio(ratio: ColumnRowRatio): string {
  return `${ratio.columns}:${ratio.rows}`;
}

/**
 * Ideal column count for N chronological cells under a columns:rows target.
 * columns/rows ≈ ratio.columns/ratio.rows and columns*rows ≈ N.
 */
export function targetColumnCountForRatio(
  itemCount: number,
  ratio: ColumnRowRatio,
): number {
  const n = Math.max(0, Math.floor(itemCount));
  if (n <= 0) return 1;
  if (n === 1) return 1;
  const cols = Math.round(Math.sqrt((n * ratio.columns) / ratio.rows));
  return Math.max(1, Math.min(n, cols));
}

/** Ideal row count for N cells (sideways packing / debug). */
export function targetRowCountForRatio(
  itemCount: number,
  ratio: ColumnRowRatio,
): number {
  const n = Math.max(0, Math.floor(itemCount));
  if (n <= 0) return 1;
  const cols = targetColumnCountForRatio(n, ratio);
  return Math.max(1, Math.ceil(n / cols));
}

export function normalizeUserLayoutSettings(
  raw: Partial<UserLayoutSettings> | null | undefined,
): UserLayoutSettings {
  const direction =
    raw?.chronologicalDirection === 'sideways' ? 'sideways' : 'down';
  const maxColumnHeight =
    raw?.maxColumnHeight === null || raw?.maxColumnHeight === undefined
      ? null
      : isPositiveLimit(raw.maxColumnHeight)
        ? raw.maxColumnHeight
        : null;
  const maxRowWidth =
    raw?.maxRowWidth === null || raw?.maxRowWidth === undefined
      ? null
      : isPositiveLimit(raw.maxRowWidth)
        ? raw.maxRowWidth
        : null;
  const columnRowRatio =
    raw?.columnRowRatio === undefined
      ? null
      : normalizeColumnRowRatio(raw.columnRowRatio);
  return {
    chronologicalDirection: direction,
    maxColumnHeight,
    maxRowWidth,
    columnRowRatio,
  };
}

function loadFromStorage(): UserLayoutSettings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_USER_LAYOUT_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_LAYOUT_SETTINGS };
    return normalizeUserLayoutSettings(JSON.parse(raw) as Partial<UserLayoutSettings>);
  } catch {
    return { ...DEFAULT_USER_LAYOUT_SETTINGS };
  }
}

function persist(settings: UserLayoutSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota / private mode — keep in-memory only.
  }
}

function emit(): void {
  for (const l of listeners) l();
}

export function getUserLayoutSettings(): UserLayoutSettings {
  return current;
}

export function setUserLayoutSettings(
  patch: Partial<UserLayoutSettings>,
): UserLayoutSettings {
  current = normalizeUserLayoutSettings({ ...current, ...patch });
  persist(current);
  emit();
  return current;
}

export function resetUserLayoutSettings(): UserLayoutSettings {
  current = { ...DEFAULT_USER_LAYOUT_SETTINGS };
  persist(current);
  emit();
  return current;
}

/** Subscribe for React useSyncExternalStore. */
export function subscribeUserLayoutSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUserLayoutSettingsSnapshot(): UserLayoutSettings {
  return current;
}

/** Test helper — replace in-memory settings without touching localStorage. */
export function setUserLayoutSettingsForTests(
  settings: UserLayoutSettings | null,
): void {
  current = settings
    ? normalizeUserLayoutSettings(settings)
    : loadFromStorage();
  emit();
}
