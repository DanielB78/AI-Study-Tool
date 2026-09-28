export type {
  CanvasOperation,
  CanvasAgentResponse,
  CreateTextOperation,
  UpdateTextOperation,
  Placement,
  PlacementRelation,
} from './operations';
export {
  CANVAS_AGENT_JSON_SCHEMA,
  CANVAS_AGENT_OUTPUT_CONTRACT,
  PLACEMENT_RELATIONS,
} from './operations';
export {
  parseCanvasAgentResponse,
  describeOperationPlan,
  CanvasAgentParseError,
  stripCodeFences,
} from './parser';
export { executeCanvasOperations, type ExecuteAgentOpsResult } from './executor';
export { executeAgentOperationsLive, createLiveAgentExecutorTarget } from './liveExecutor';
export { resolvePlacement, DEFAULT_ELEMENT_GAP } from './placementService';
export {
  CANVAS_EDITOR_SYSTEM_PROMPT,
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
} from './prompts/loadAgentPrompt';
