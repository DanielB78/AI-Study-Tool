/**
 * Application-defined layout presets for LLM output types.
 * The LLM selects the output type; the app owns geometry parameters.
 */

export const AGENT_OUTPUT_TYPES = ['lesson', 'step_by_step'] as const;
export type AgentOutputType = (typeof AGENT_OUTPUT_TYPES)[number];

export type CellArrangement = 'vertical_stack' | 'horizontal_pair';
export type GridArrangement = 'chronological_grid' | 'vertical_sequence';

export type OutputLayoutConfig = {
  outputType: AgentOutputType;
  /** Hard max objects sharing one layout_cell (after auto-split). */
  maxObjectsPerCell: number;
  cellArrangement: CellArrangement;
  gridArrangement: GridArrangement;
  /** Horizontal gap between paired objects (step_by_step). */
  pairGap: number;
  /** Soft cap on paired-cell content width (world units). */
  maxPairWidth: number;
  /** Human-readable labels for debug UI. */
  labels: {
    outputType: string;
    layout: string;
    cellArrangement: string;
  };
};

export const LESSON_OUTPUT_LAYOUT: OutputLayoutConfig = {
  outputType: 'lesson',
  maxObjectsPerCell: 4,
  cellArrangement: 'vertical_stack',
  gridArrangement: 'chronological_grid',
  pairGap: 28,
  maxPairWidth: 960,
  labels: {
    outputType: 'Lesson',
    layout: 'Chronological grid',
    cellArrangement: 'Vertical stack',
  },
};

export const STEP_BY_STEP_OUTPUT_LAYOUT: OutputLayoutConfig = {
  outputType: 'step_by_step',
  maxObjectsPerCell: 2,
  cellArrangement: 'horizontal_pair',
  gridArrangement: 'vertical_sequence',
  pairGap: 28,
  /** Keep paired steps readable; wider content falls back to vertical stack. */
  maxPairWidth: 920,
  labels: {
    outputType: 'Step by Step',
    layout: 'Vertical sequence',
    cellArrangement: 'Horizontal pair',
  },
};

export function getOutputLayoutConfig(
  outputType: AgentOutputType | undefined | null,
): OutputLayoutConfig {
  if (outputType === 'step_by_step') return STEP_BY_STEP_OUTPUT_LAYOUT;
  return LESSON_OUTPUT_LAYOUT;
}

export function isAgentOutputType(v: unknown): v is AgentOutputType {
  return v === 'lesson' || v === 'step_by_step';
}

/**
 * Lightweight local hint mirroring High-mode selection rules.
 * Authoritative choice is the LLM `output_type` field; this is for tests /
 * diagnostics only — not a paid classification call.
 */
export function classifyOutputTypeHint(userRequest: string): AgentOutputType {
  const q = userRequest.trim().toLowerCase();
  if (!q) return 'lesson';

  // Explicit overrides
  if (/\bstep[-\s]?by[-\s]?step\b/.test(q) || /\bfull working\b/.test(q)) {
    return 'step_by_step';
  }
  if (/\b(lesson|teach me|explain the topic)\b/.test(q)) {
    return 'lesson';
  }

  const stepSignals = [
    /\bderive\b/,
    /\bderivation\b/,
    /\bsolve\b/,
    /\bwork(?:ed)? through\b/,
    /\bshow (?:the )?full working\b/,
    /\bintegrat(?:e|ion)\b/,
    /\bdifferential equation\b/,
    /\bcalculate\b.*\busing\b/,
    /\bshow how to\b/,
    /\bstep by step\b/,
    /\bmechanics (?:question|problem)\b/,
    /\bworking for\b/,
  ];
  if (stepSignals.some((re) => re.test(q))) return 'step_by_step';

  return 'lesson';
}
