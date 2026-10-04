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
} from './contextBuilder';
export {
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_IMAGES,
} from './config';
export {
  resolveExplicitSelection,
  snapshotEditorSelection,
  extractElementContextContent,
} from './explicitSelection';
export type { ExplicitSelectionInput } from './explicitSelection';
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
