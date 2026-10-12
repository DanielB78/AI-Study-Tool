/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_API_BASE_URL?: string;
  readonly VITE_LLM_EXECUTION_MODE?: string;
  readonly VITE_RAG_MAX_CONTEXT_ELEMENTS?: string;
  readonly VITE_RAG_MAX_CONTEXT_CHARACTERS?: string;
  readonly VITE_RAG_SPATIAL_RADIUS_MAX?: string;
  readonly VITE_RAG_SPATIAL_RADIUS_DEFAULT?: string;
  readonly VITE_RAG_SPATIAL_RADIUS_STEP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
