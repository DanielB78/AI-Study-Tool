/**
 * RAG indexer client configuration.
 * Override with VITE_AI_API_BASE_URL (same backend as chat).
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

export const RAG_API_BASE_URL =
  (import.meta.env.VITE_AI_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_BASE_URL;
