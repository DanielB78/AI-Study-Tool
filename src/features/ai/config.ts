/**
 * Client configuration for the AI backend.
 *
 * Override in development with a Vite env var, e.g. in `.env.local`:
 *   VITE_AI_API_BASE_URL=http://127.0.0.1:8000
 *
 * Keep this the single source of truth — do not hard-code URLs in widgets.
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

export const AI_API_BASE_URL =
  (import.meta.env.VITE_AI_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_BASE_URL;

/** Request timeout for a full (non-streaming) chat round-trip. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;
