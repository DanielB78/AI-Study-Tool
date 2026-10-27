export type {
  ContentDocument,
  ContentDocumentNode,
  ContentInlineSpan,
  ContentComponentKind,
  ContentJsonInstruction,
  ContentJsonSegment,
  ContentFirstEnvelope,
} from './types';
export { ContentParseError } from './types';

export {
  parseContentDocument,
  parseInlineSpans,
  tokenizeContentBlocks,
  looksLikeContentMarkdown,
  looksLikeOperationsJson,
} from './contentParser';

export {
  splitContentFirstEnvelope,
  stripContentFence,
  hasJsonDirectives,
} from './jsonDirective';

export {
  compileContentDocument,
  type CompileContentResult,
  type ContentAssociationPlan,
} from './compileContentDocument';

export {
  compileJsonSegment,
  compileJsonSegments,
  compileJsonEditSegment,
  compileAddTextBatch,
  documentToSingleRichText,
} from './compileJsonInstructions';

export {
  getAiGenerationMode,
  setAiGenerationModeOverride,
  isContentFirstMode,
  isOperationsMode,
  DEFAULT_AI_GENERATION_MODE,
  type AiGenerationMode,
} from './generationMode';

export {
  CONTENT_FIRST_SYSTEM_PROMPT,
  CONTENT_FIRST_RESPONSE_INSTRUCTIONS,
  CONTENT_FIRST_PROMPT_MAX_CHARS,
  assertContentFirstPromptFitsLimit,
} from './contentFirstPrompt';

export {
  parseContentFirstToAgentResponse,
  previewContentFirstPlan,
  handleContentFirstResponse,
  type ContentFirstHandleResult,
} from './applyContentFirst';
