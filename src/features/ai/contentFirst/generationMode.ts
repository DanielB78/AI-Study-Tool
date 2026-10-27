/**
 * Generation mode: content-first Markdown (default on this experimental branch)
 * vs structured JSON operations (editing / comparison).
 *
 * Override with VITE_AI_GENERATION_MODE=operations to restore JSON-ops generation,
 * or use the RAG debug **Generation format** toggle at runtime.
 */

export type AiGenerationMode = 'operations' | 'content_first';

/** Experimental default: Markdown authoring → app compiles canvas ops. */
const DEFAULT_MODE: AiGenerationMode = 'content_first';

function parseMode(raw: string | undefined): AiGenerationMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (
    v === 'content_first' ||
    v === 'content-first' ||
    v === 'markdown' ||
    v === 'content'
  ) {
    return 'content_first';
  }
  if (v === 'operations' || v === 'ops' || v === 'json') {
    return 'operations';
  }
  // Unset / unknown → experimental default
  return DEFAULT_MODE;
}

export const DEFAULT_AI_GENERATION_MODE: AiGenerationMode = parseMode(
  import.meta.env.VITE_AI_GENERATION_MODE as string | undefined,
);

let runtimeOverride: AiGenerationMode | null = null;

export function getAiGenerationMode(): AiGenerationMode {
  return runtimeOverride ?? DEFAULT_AI_GENERATION_MODE;
}

export function setAiGenerationModeOverride(
  mode: AiGenerationMode | null,
): void {
  runtimeOverride = mode;
}

export function isContentFirstMode(
  mode: AiGenerationMode = getAiGenerationMode(),
): boolean {
  return mode === 'content_first';
}

export function isOperationsMode(
  mode: AiGenerationMode = getAiGenerationMode(),
): boolean {
  return mode === 'operations';
}
