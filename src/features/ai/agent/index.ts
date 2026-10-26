export type {
  CanvasOperation,
  CanvasAgentResponse,
  CreateTextOperation,
  CreateEquationOperation,
  CreateStructuredNoteOperation,
  CreateGraphOperation,
  GridLayoutSpec,
  GridLayoutItemSpec,
  AnyLayoutSpec,
  ChronologicalGridLayoutSpec,
  AgentOutputType,
  LayoutRole,
  CreateGraphExpressionSpec,
  CreateGraphPointSpec,
  CreateGraphViewportSpec,
  CreateGraphSettingsSpec,
  AddGraphExpressionOperation,
  UpdateGraphExpressionOperation,
  RemoveGraphExpressionOperation,
  SetGraphExpressionVisibilityOperation,
  UpdateGraphViewportOperation,
  UpdateGraphSettingsOperation,
  AddGraphPointOperation,
  UpdateGraphPointOperation,
  RemoveGraphPointOperation,
  UpdateTextOperation,
  Placement,
  PlacementRelation,
  StructuredFieldPayload,
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
  type ParseContext,
  type DescribePlanOptions,
} from './parser';
export {
  CanvasAgentExecuteError,
  type ExecuteErrorStage,
} from './parseErrors';
export { executeCanvasOperations, type ExecuteAgentOpsResult } from './executor';
export { executeAgentOperationsLive, createLiveAgentExecutorTarget } from './liveExecutor';
export { resolvePlacement, DEFAULT_ELEMENT_GAP } from './placementService';
export {
  dominantCollisionPush,
  resolveCascadeCollisions,
  type CollisionPush,
  type CollisionSide,
  type CascadeCollisionResult,
} from './collisionResolver';
export {
  CANVAS_EDITOR_SYSTEM_PROMPT,
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
  CANVAS_AGENT_DOCUMENT_ID,
  CANVAS_AGENT_MODE,
} from './prompts/loadAgentPrompt';
export {
  GRID_LAYOUT_CONFIG,
  calculateGridLayout,
  placeGridOnCanvas,
  resolveGridPlan,
  previewGridPlan,
  type LayoutDebugInfo,
} from './layout';
