export { ragIndexer, createRagIndexer } from './ragIndexer';
export { ragSync, RagSyncController } from './ragSync';
export {
  ragRetrievalService,
  createRagRetrievalService,
  debugRetrieve,
} from './ragRetrieval';
export type {
  PromptIntentClassification,
  PromptIntentScore,
  PromptIntentId,
  RetrieveResponse,
} from './ragRetrieval';
export { boundingBoxDistance, expandRect } from './geometry';
export {
  findElementsWithinRadius,
  findElementsNearAnchors,
  isSpatiallyEligible,
  deriveSpatialElementRecords,
  deriveImageSpatialRecords,
  toSpatialElementRecord,
  hashAssetRef,
} from './spatialContext';
export type {
  SpatialHit,
  SpatialElementRecord,
  ImageSpatialRecord,
  SpatialElementLike,
} from './spatialContext';
export {
  buildRagContext,
  serializeRagContext,
  DEFAULT_RAG_SYSTEM_INSTRUCTION,
} from './contextBuilder';
export type {
  RagContext,
  RagContextElement,
  RagContextImageAttachment,
  RagContextStats,
  CanvasRegionImageContext,
  RegionImageInput,
} from './contextBuilder';
export {
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_IMAGES,
  REGION_CONTEXT_RENDER_SCALE,
  REGION_CONTEXT_MAX_DIMENSION,
  REGION_CONTEXT_MIN_DIMENSION,
} from './config';
export {
  resolveExplicitSelection,
  snapshotEditorSelection,
  extractElementContextContent,
} from './explicitSelection';
export type { ExplicitSelectionInput } from './explicitSelection';
export {
  inspectCanvasRegion,
  isStructuredWithoutImage,
  isVisualUnstructuredContent,
  elementsIntersectingRegion,
  regionAttachmentId,
  STRUCTURED_WITHOUT_IMAGE,
} from './regionContext';
export type {
  CanvasRegionInspection,
  ExplicitRegionSelectionSnapshot,
  RegionContextKind,
} from './regionContext';
export {
  renderCanvasRegion,
  computeRegionRenderSize,
  REGION_CONTEXT_BACKGROUND,
} from './regionRenderer';
export type { RegionRenderResult, RegionRenderSize } from './regionRenderer';
export {
  toGraphContextItem,
  formatGraphContextItem,
  formatGraphElementForContext,
  summarizeGraphForDebug,
} from './graphContext';
export type {
  GraphContextItem,
  GraphContextExpression,
  GraphContextPoint,
  GraphContextViewport,
  GraphContextSettings,
} from './graphContext';
export {
  semanticExpansionService,
  createSemanticExpansionService,
  buildSemanticTrees,
  semanticHitsForContext,
} from './semanticExpansion';
export type {
  SemanticExpandResponse,
  SemanticExpansionEdge,
  SemanticTreeNode,
} from './semanticExpansion';
export { useRagDebugStore, computeDebugContext } from './ragDebugStore';
export { RagDebugPanel } from './ui/RagDebugPanel';
export { RagDebugOverlay } from './ui/RagDebugOverlay';
export { HandwritingDebugOverlay } from './ui/HandwritingDebugOverlay';
export {
  detectHandwritingRegions,
  extractDrawingStrokes,
  strokeBoundsFromDrawing,
  estimateHandwritingScale,
  handwritingContentKey,
} from './handwritingRegionDetector';
export type {
  HandwritingDetectionResult,
  HandwritingLine,
  HandwritingRegion,
  StrokeBounds,
} from './handwritingTypes';
export {
  DEFAULT_HANDWRITING_REGION_CONFIG,
  mergeHandwritingConfig,
} from './handwritingConfig';
export type { HandwritingRegionDetectionConfig } from './handwritingConfig';
export {
  useHandwritingDebugStore,
  createHandwritingDebugStore,
} from './handwritingDebugStore';
