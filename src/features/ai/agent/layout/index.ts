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
export { placeGridOnCanvas, spiralOffsets } from './canvasPlacementEngine';
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
} from './types';
