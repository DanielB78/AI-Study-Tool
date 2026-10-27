export { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
export {
  expandRect,
  translateRect,
  intersectsWithMargin,
  anyPairCollides,
  collidesAny,
  unionBounds,
} from './collision';
export { collectCanvasObstacles } from './obstacles';
export { calculateGridLayout } from './gridLayoutEngine';
export { placeGridOnCanvas } from './canvasPlacementEngine';
export { spiralOffsets } from './spiral';
export {
  maxColumnsForObjectCount,
  reflowGridToMaxColumns,
  reduceColumnsForWidth,
  normalizeGridLayout,
  type ReflowResult,
  type WrapReason,
} from './gridReflow';
export {
  groupCreationOpsIntoCells,
  calculateChronologicalCellGrid,
  assignCellsToGrid,
  MAX_OBJECTS_PER_CELL,
  ChronologicalCellLayoutError,
  type LayoutCell,
  type GroupCellsResult,
} from './chronologicalCellLayout';
export {
  getOutputLayoutConfig,
  classifyOutputTypeHint,
  LESSON_OUTPUT_LAYOUT,
  STEP_BY_STEP_OUTPUT_LAYOUT,
  AGENT_OUTPUT_TYPES,
  type AgentOutputType,
  type OutputLayoutConfig,
  type CellArrangement,
  type GridArrangement,
} from './outputLayoutConfig';
export {
  measureLayoutItems,
  isGridCreatableOp,
  type MeasureContext,
} from './measure';
export {
  resolveGridPlan,
  previewGridPlan,
  type ResolveGridPlanInput,
  type ResolveGridPlanResult,
} from './resolveGridPlan';
export type {
  GridLayoutSpec,
  GridLayoutItemSpec,
  MeasuredLayoutItem,
  PlacedLayoutItem,
  GridLayoutResult,
  ObstacleRect,
  CanvasPlacementResult,
  LayoutDebugInfo,
  TextAutoSizeDebug,
  ChronologicalCellDebug,
} from './types';
