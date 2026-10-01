export type {
  NoteStructure,
  NoteStructureField,
  NoteStructureNodeSection,
  StructureComponent,
  StructureFieldContentType,
  StructureFieldStyle,
  NodeTemplate,
  NodeSectionLayoutMode,
  NodeSectionConnectorConfig,
} from './types';
export {
  NOTE_STRUCTURE_VERSION,
  DEFAULT_STRUCTURE_FIELD_STYLE,
  DEFAULT_STRUCTURE_WIDTH,
  DEFAULT_STRUCTURE_HEIGHT,
  DEFAULT_NODE_SECTION_MAX_DEPTH,
  DEFAULT_NODE_SECTION_MAX_TOTAL_NODES,
  isNodeSection,
  isStructureField,
} from './types';
export {
  createEmptyStructure,
  createStructureField,
  createNodeSection,
  createConceptSummaryStructure,
  createKnowledgeTreeStructure,
  duplicateStructure,
} from './factory';
export {
  loadStructureLibrary,
  saveStructureLibrary,
  parseStructureLibrary,
  serializeStructureLibrary,
  NOTE_STRUCTURE_STORAGE_KEY,
} from './storage';
export {
  formatNoteStructureForPrompt,
  formatNoStructureSelected,
} from './formatForPrompt';
export {
  instantiateNoteStructure,
  structureBoundsSize,
  computeStructuredNoteBounds,
} from './instantiation';
export {
  layoutNodeSectionHierarchy,
  previewHierarchyForSection,
} from './nodeSectionLayout';
export {
  countHierarchyNodes,
  maxHierarchyDepth,
  formatHierarchyTreePreview,
} from './hierarchy';
export { useStructureStore, createStructureStore } from './structureStore';
export { StructureLibraryPanel, StructureSelector } from './ui';
