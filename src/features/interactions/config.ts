/** Interaction-memory config (frontend mirrors backend defaults). */

function envInt(name: string, fallback: number): number {
  const raw = import.meta.env[name] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const RECENT_INTERACTION_COUNT = envInt('VITE_RECENT_INTERACTION_COUNT', 3);
export const INTERACTION_RAG_TOP_K = envInt('VITE_INTERACTION_RAG_TOP_K', 5);
