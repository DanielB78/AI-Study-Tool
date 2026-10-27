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

export type UserLayoutSettings = {
  chronologicalDirection: ChronologicalDirection;
  /** World-space max column height, or null = No limit. */
  maxColumnHeight: number | null;
  /** World-space max row / group width, or null = No limit. */
  maxRowWidth: number | null;
};

export const DEFAULT_USER_LAYOUT_SETTINGS: UserLayoutSettings = {
  chronologicalDirection: 'down',
  maxColumnHeight: null,
  maxRowWidth: null,
};

/** Suggested values when the user turns a limit on. */
export const DEFAULT_LIMIT_SUGGESTIONS = {
  maxColumnHeight: 900,
  maxRowWidth: 1200,
} as const;

const STORAGE_KEY = 'ai-study-tool:user-layout-settings:v1';

type Listener = () => void;

let current: UserLayoutSettings = loadFromStorage();
const listeners = new Set<Listener>();

function isPositiveLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
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
  return {
    chronologicalDirection: direction,
    maxColumnHeight,
    maxRowWidth,
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
