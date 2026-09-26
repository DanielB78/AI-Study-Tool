/**
 * LLM execution mode — manual (no paid API) vs automatic (backend LLM).
 *
 * Default is MANUAL so development never accidentally burns API credits.
 * Override with VITE_LLM_EXECUTION_MODE=automatic when ready.
 */

export type LlmExecutionMode = 'manual' | 'automatic';

const DEFAULT_MODE: LlmExecutionMode = 'manual';

function parseMode(raw: string | undefined): LlmExecutionMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'automatic' || v === 'auto' || v === 'api') return 'automatic';
  if (v === 'manual' || v === '') return 'manual';
  return DEFAULT_MODE;
}

/** Env-configured default (read once at module load). */
export const DEFAULT_LLM_EXECUTION_MODE: LlmExecutionMode = parseMode(
  import.meta.env.VITE_LLM_EXECUTION_MODE as string | undefined,
);

/** Optional runtime override (tests / debug panel can flip Ask AI behavior). */
let runtimeOverride: LlmExecutionMode | null = null;

export function getLlmExecutionMode(): LlmExecutionMode {
  return runtimeOverride ?? DEFAULT_LLM_EXECUTION_MODE;
}

export function setLlmExecutionModeOverride(mode: LlmExecutionMode | null): void {
  runtimeOverride = mode;
}

export function isManualLlmMode(mode: LlmExecutionMode = getLlmExecutionMode()): boolean {
  return mode === 'manual';
}

export function isAutomaticLlmMode(mode: LlmExecutionMode = getLlmExecutionMode()): boolean {
  return mode === 'automatic';
}
