/**
 * Generation mode: structured JSON operations vs content-first Markdown.
 *
 * Default remains `operations` so existing behaviour is preserved.
 * Override with VITE_AI_GENERATION_MODE=content_first for the experiment.
 */

export type AiGenerationMode = 'operations' | 'content_first';

const DEFAULT_MODE: AiGenerationMode = 'operations';

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
  if (v === 'operations' || v === 'ops' || v === 'json' || v === '') {
    return DEFAULT_MODE;
  }
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
