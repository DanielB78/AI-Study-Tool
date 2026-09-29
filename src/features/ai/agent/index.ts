export type {
  CanvasOperation,
  CanvasAgentResponse,
  CreateTextOperation,
  UpdateTextOperation,
  UpdateTextStyleOperation,
  MoveTextOperation,
  ResizeTextOperation,
  DeleteTextOperation,
  Placement,
  PlacementRelation,
  TextStylePatch,
} from './operations';
export {
  CANVAS_AGENT_JSON_SCHEMA,
  CANVAS_AGENT_OUTPUT_CONTRACT,
  PLACEMENT_RELATIONS,
  AI_TEXT_MIN_WIDTH,
  AI_TEXT_MIN_HEIGHT,
  AI_TEXT_MAX_WIDTH,
  AI_TEXT_MAX_HEIGHT,
} from './operations';
export {
  parseCanvasAgentResponse,
  parseTextStylePatch,
  describeOperationPlan,
  CanvasAgentParseError,
  stripCodeFences,
} from './parser';
export {
  summarizeAiActions,
  summarizeStyleUpdate,
  buildInteractionEmbeddingDocument,
  describeOperationPlanLines,
} from './actionSummary';
export {
  normalizeCssColor,
  normalizeBackgroundColor,
  normalizeTextStylePatch,
  applyTextStylePatch,
  describeStylePatch,
  summarizeStylePatch,
  isEmptyStylePatch,
  ColorNormalizeFailure,
} from './textStyle';
export { executeCanvasOperations, type ExecuteAgentOpsResult } from './executor';
export { executeAgentOperationsLive, createLiveAgentExecutorTarget } from './liveExecutor';
export { resolvePlacement, DEFAULT_ELEMENT_GAP } from './placementService';
export {
  CANVAS_EDITOR_SYSTEM_PROMPT,
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
} from './prompts/loadAgentPrompt';
