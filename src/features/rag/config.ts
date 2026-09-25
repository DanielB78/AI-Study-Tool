/**
 * RAG indexer / retrieval / debug context configuration.
 * Override with VITE_* env vars where noted.
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

export const RAG_API_BASE_URL =
  (import.meta.env.VITE_AI_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_BASE_URL;

function envInt(name: string, fallback: number): number {
  const raw = import.meta.env[name] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Context budget — semantic anchors always retained first. */
export const RAG_MAX_CONTEXT_ELEMENTS = envInt('VITE_RAG_MAX_CONTEXT_ELEMENTS', 12);
export const RAG_MAX_CONTEXT_CHARACTERS = envInt('VITE_RAG_MAX_CONTEXT_CHARACTERS', 12_000);

/** Spatial radius (world units). Default/range are for the debug slider. */
export const RAG_SPATIAL_RADIUS_MIN = 0;
export const RAG_SPATIAL_RADIUS_MAX = envInt('VITE_RAG_SPATIAL_RADIUS_MAX', 2000);
export const RAG_SPATIAL_RADIUS_DEFAULT = envInt('VITE_RAG_SPATIAL_RADIUS_DEFAULT', 300);
export const RAG_SPATIAL_RADIUS_STEP = envInt('VITE_RAG_SPATIAL_RADIUS_STEP', 25);
