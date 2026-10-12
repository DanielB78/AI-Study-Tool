import { useMemo, useState, useEffect, useSyncExternalStore } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import { buildLlmPrompt } from '../../ai/llm';
import { StructureSelector } from '../../structures/ui/StructureSelector';
import { useStructureStore } from '../../structures/structureStore';
import {
  formatNoStructureSelected,
  formatNoteStructureForPrompt,
} from '../../structures/formatForPrompt';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_MAX_CONTEXT_IMAGES,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MAX,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MIN,
  RAG_SPATIAL_RADIUS_MAX,
  RAG_SPATIAL_RADIUS_MIN,
  RAG_SPATIAL_RADIUS_STEP,
} from '../config';
import { computeDebugContext, useRagDebugStore } from '../ragDebugStore';
import { useHandwritingDebugStore } from '../handwritingDebugStore';
import { DEFAULT_HANDWRITING_REGION_CONFIG } from '../handwritingConfig';
import {
  handwritingRecognitionController,
  resolveHandwritingRecognition,
  stableHandwritingRegionId,
} from '../handwritingSync';
import type { SemanticTreeNode } from '../semanticExpansion';

type RagDebugPage =
  | 'selected'
  | 'structure'
  | 'intent'
  | 'matches'
  | 'spatial'
  | 'semantic'
  | 'handwriting'
  | 'context';

const RAG_DEBUG_PAGES: { id: RagDebugPage; label: string }[] = [
  { id: 'selected', label: 'Selected' },
  { id: 'structure', label: 'Structure' },
  { id: 'intent', label: 'Intent' },
  { id: 'matches', label: 'Matches' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'semantic', label: 'Semantic' },
  { id: 'handwriting', label: 'Handwriting' },
  { id: 'context', label: 'Context' },
];

function previewText(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function SemanticTreeBranch({
  node,
  included,
  collapsedKeys,
  onToggleInclude,
  onToggleBranch,
}: {
  node: SemanticTreeNode;
  included: ReadonlySet<string>;
  collapsedKeys: ReadonlySet<string>;
  onToggleInclude: (id: string) => void;
  onToggleBranch: (key: string) => void;
}) {
  const branchKey = `${node.root_anchor_element_id}:${node.element_id}`;
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedKeys.has(branchKey);
  const isRoot = node.depth === 0;
  const checked = isRoot ? true : included.has(node.element_id);

  return (
    <li className={`rag-debug-tree-node depth-${node.depth}`}>
      <div className="rag-debug-tree-row">
        {hasChildren ? (
          <button
            type="button"
            className="rag-debug-tree-toggle"
            onClick={() => onToggleBranch(branchKey)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="rag-debug-tree-spacer" />
        )}
        {!isRoot ? (
          <label className="rag-debug-tree-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleInclude(node.element_id)}
            />
            {node.similarity != null && (
              <span className="rag-debug-score">{node.similarity.toFixed(3)}</span>
            )}
            <span className="rag-debug-id">{node.element_id}</span>
            <span className="rag-debug-meta">d{node.depth}</span>
          </label>
        ) : (
          <span className="rag-debug-tree-label">
            <strong className="rag-debug-id">{node.element_id}</strong>
            <span className="rag-debug-meta">anchor</span>
          </span>
        )}
      </div>
      <p className="rag-debug-preview">{previewText(node.preview, 70)}</p>
      {!isRoot && node.gap_from_previous != null && (
        <p className="rag-debug-meta">gap {node.gap_from_previous.toFixed(3)}</p>
      )}
      {hasChildren && !collapsed && (
        <ul className="rag-debug-tree">
          {node.children.map((child) => (
            <SemanticTreeBranch
              key={`${child.root_anchor_element_id}:${child.parent_element_id}:${child.element_id}`}
              node={child}
              included={included}
              collapsedKeys={collapsedKeys}
              onToggleInclude={onToggleInclude}
              onToggleBranch={onToggleBranch}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Development-only RAG debug panel: retrieve → anchors → spatial / semantic
 * expansion → copy LLM prompt / paste response (Manual LLM Mode by default).
 */
export function RagDebugPanel() {
  const [page, setPage] = useState<RagDebugPage>('selected');
  const open = useRagDebugStore((s) => s.open);
  const prompt = useRagDebugStore((s) => s.prompt);
  const retrieving = useRagDebugStore((s) => s.retrieving);
  const expanding = useRagDebugStore((s) => s.expanding);
  const sending = useRagDebugStore((s) => s.sending);
  const error = useRagDebugStore((s) => s.error);
  const statusMessage = useRagDebugStore((s) => s.statusMessage);
  const candidates = useRagDebugStore((s) => s.candidates);
  const selectedAnchorIds = useRagDebugStore((s) => s.selectedAnchorIds);
  const explicitSelectionIds = useRagDebugStore((s) => s.explicitSelectionIds);
  const explicitRegionBounds = useRagDebugStore((s) => s.explicitRegionBounds);
  const explicitRegionInspection = useRagDebugStore((s) => s.explicitRegionInspection);
  const explicitRegionImageSrc = useRagDebugStore((s) => s.explicitRegionImageSrc);
  const selectedStructureId = useRagDebugStore((s) => s.selectedStructureId);
  const spatialExpansionEnabled = useRagDebugStore((s) => s.spatialExpansionEnabled);
  const radius = useRagDebugStore((s) => s.radius);
  const spatialExcludedIds = useRagDebugStore((s) => s.spatialExcludedIds);
  const semanticExpansionEnabled = useRagDebugStore((s) => s.semanticExpansionEnabled);
  const semanticExpansionDepth = useRagDebugStore((s) => s.semanticExpansionDepth);
  const semanticMaxNeighbours = useRagDebugStore((s) => s.semanticMaxNeighbours);
  const semanticExpandResponse = useRagDebugStore((s) => s.semanticExpandResponse);
  const semanticIncludedIds = useRagDebugStore((s) => s.semanticIncludedIds);
  const semanticCollapsedKeys = useRagDebugStore((s) => s.semanticCollapsedKeys);
  const previewOpen = useRagDebugStore((s) => s.previewOpen);
  const llmPromptPreviewOpen = useRagDebugStore((s) => s.llmPromptPreviewOpen);
  const responseModalOpen = useRagDebugStore((s) => s.responseModalOpen);
  const pastedResponse = useRagDebugStore((s) => s.pastedResponse);
  const pendingPlan = useRagDebugStore((s) => s.pendingPlan);
  const pendingOperations = useRagDebugStore((s) => s.pendingOperations);
  const layoutDebug = useRagDebugStore((s) => s.layoutDebug);
  const parseError = useRagDebugStore((s) => s.parseError);
  const llmExecutionMode = useRagDebugStore((s) => s.llmExecutionMode);
  const lastQueryChunks = useRagDebugStore((s) => s.lastQueryChunks);
  const lastRetrieveMeta = useRagDebugStore((s) => s.lastRetrieveMeta);
  const promptIntent = useRagDebugStore((s) => s.promptIntent);
  const elements = useCanvasStore((s) => s.document.elements);
  const liveEditorSelectedIds = useCanvasStore((s) => s.selectedIds);

  const setPrompt = useRagDebugStore((s) => s.setPrompt);
  const setRadius = useRagDebugStore((s) => s.setRadius);
  const setSpatialExpansionEnabled = useRagDebugStore((s) => s.setSpatialExpansionEnabled);
  const toggleSpatialIncluded = useRagDebugStore((s) => s.toggleSpatialIncluded);
  const selectAllSpatialHits = useRagDebugStore((s) => s.selectAllSpatialHits);
  const clearSpatialSelection = useRagDebugStore((s) => s.clearSpatialSelection);
  const setSemanticExpansionEnabled = useRagDebugStore((s) => s.setSemanticExpansionEnabled);
  const setSemanticExpansionDepth = useRagDebugStore((s) => s.setSemanticExpansionDepth);
  const setSemanticMaxNeighbours = useRagDebugStore((s) => s.setSemanticMaxNeighbours);
  const toggleSemanticIncluded = useRagDebugStore((s) => s.toggleSemanticIncluded);
  const selectAllSemanticExpansion = useRagDebugStore((s) => s.selectAllSemanticExpansion);
  const clearSemanticExpansionSelection = useRagDebugStore(
    (s) => s.clearSemanticExpansionSelection,
  );
  const selectTopSemanticExpansion = useRagDebugStore((s) => s.selectTopSemanticExpansion);
  const toggleSemanticBranch = useRagDebugStore((s) => s.toggleSemanticBranch);
  const refreshSemanticExpansion = useRagDebugStore((s) => s.refreshSemanticExpansion);
  const toggleAnchor = useRagDebugStore((s) => s.toggleAnchor);
  const selectTopN = useRagDebugStore((s) => s.selectTopN);
  const clearAnchors = useRagDebugStore((s) => s.clearAnchors);
  const retrieve = useRagDebugStore((s) => s.retrieve);
  const sendWithContext = useRagDebugStore((s) => s.sendWithContext);
  const setPreviewOpen = useRagDebugStore((s) => s.setPreviewOpen);
  const setLlmPromptPreviewOpen = useRagDebugStore((s) => s.setLlmPromptPreviewOpen);
  const setLlmExecutionMode = useRagDebugStore((s) => s.setLlmExecutionMode);
  const copyLlmPrompt = useRagDebugStore((s) => s.copyLlmPrompt);
  const openResponseModal = useRagDebugStore((s) => s.openResponseModal);
  const closeResponseModal = useRagDebugStore((s) => s.closeResponseModal);
  const setPastedResponse = useRagDebugStore((s) => s.setPastedResponse);
  const previewPastedPlan = useRagDebugStore((s) => s.previewPastedPlan);
  const pasteResponseFromClipboard = useRagDebugStore((s) => s.pasteResponseFromClipboard);
  const applyPastedResponse = useRagDebugStore((s) => s.applyPastedResponse);
  const copyRetrievalDebugData = useRagDebugStore((s) => s.copyRetrievalDebugData);
  const closePanel = useRagDebugStore((s) => s.closePanel);
  const togglePanel = useRagDebugStore((s) => s.togglePanel);

  const hwShowRegions = useHandwritingDebugStore((s) => s.showRegions);
  const hwShowLines = useHandwritingDebugStore((s) => s.showLines);
  const hwConfig = useHandwritingDebugStore((s) => s.config);
  const hwResult = useHandwritingDebugStore((s) => s.result);
  const hwSelectedRegionId = useHandwritingDebugStore((s) => s.selectedRegionId);
  const hwSelectedLineId = useHandwritingDebugStore((s) => s.selectedLineId);
  const setHwShowRegions = useHandwritingDebugStore((s) => s.setShowRegions);
  const setHwShowLines = useHandwritingDebugStore((s) => s.setShowLines);
  const setHwConfigPatch = useHandwritingDebugStore((s) => s.setConfigPatch);
  const resetHwConfig = useHandwritingDebugStore((s) => s.resetConfig);
  const selectHwRegion = useHandwritingDebugStore((s) => s.selectRegion);
  const selectHwLine = useHandwritingDebugStore((s) => s.selectLine);
  const refreshHwDetection = useHandwritingDebugStore((s) => s.refreshDetection);
  const ensureHwDetection = useHandwritingDebugStore((s) => s.ensureDetection);

  const hwRecognitionRecords = useSyncExternalStore(
    (cb) => handwritingRecognitionController.subscribe(cb),
    () => handwritingRecognitionController.getRecords(),
    () => handwritingRecognitionController.getRecords(),
  );

  // Keep handwriting stats fresh while that debug page is open.
  useEffect(() => {
    if (page === 'handwriting') {
      ensureHwDetection();
    }
  }, [page, elements, ensureHwDetection]);

  const liveStructureId = useStructureStore((s) => s.selectedStructureIdForAi);
  const structures = useStructureStore((s) => s.structures);

  const { context, spatialHits, semanticTrees } = useMemo(
    () =>
      computeDebugContext(
        {
          prompt,
          candidates,
          selectedAnchorIds,
          explicitSelectionIds,
          explicitRegionBounds,
          explicitRegionInspection,
          explicitRegionImageSrc,
          selectedStructureId,
          spatialExpansionEnabled,
          radius,
          spatialExcludedIds,
          semanticExpansionEnabled,
          semanticExpansionDepth,
          semanticMaxNeighbours,
          semanticExpandResponse,
          semanticIncludedIds,
        },
        elements,
      ),
    [
      prompt,
      candidates,
      selectedAnchorIds,
      explicitSelectionIds,
      explicitRegionBounds,
      explicitRegionInspection,
      explicitRegionImageSrc,
      selectedStructureId,
      spatialExpansionEnabled,
      radius,
      spatialExcludedIds,
      semanticExpansionEnabled,
      semanticExpansionDepth,
      semanticMaxNeighbours,
      semanticExpandResponse,
      semanticIncludedIds,
      elements,
    ],
  );

  const snapshottedStructure = useMemo(() => {
    if (!selectedStructureId) return null;
    return structures.find((s) => s.id === selectedStructureId) ?? null;
  }, [selectedStructureId, structures]);

  const llmPrompt = useMemo(() => {
    if (!prompt.trim()) return null;
    return buildLlmPrompt({
      userPrompt: prompt,
      ragContext: context,
      selectedStructure: snapshottedStructure,
    });
  }, [prompt, context, snapshottedStructure]);

  const selectedSet = useMemo(() => new Set(selectedAnchorIds), [selectedAnchorIds]);
  const includedSet = useMemo(() => new Set(semanticIncludedIds), [semanticIncludedIds]);
  const spatialExcludedSet = useMemo(
    () => new Set(spatialExcludedIds),
    [spatialExcludedIds],
  );
  const collapsedSet = useMemo(
    () => new Set(semanticCollapsedKeys),
    [semanticCollapsedKeys],
  );

  /** Deduped spatial hits for debug list (nearest distance per element). */
  const spatialHitRows = useMemo(() => {
    const byId = new Map<
      string,
      {
        element_id: string;
        element_type: string;
        distance: number;
        anchor_element_id: string;
        image_src?: string;
        text?: string;
      }
    >();
    for (const hit of spatialHits) {
      const prev = byId.get(hit.element_id);
      if (!prev || hit.distance < prev.distance) {
        byId.set(hit.element_id, {
          element_id: hit.element_id,
          element_type: hit.element_type,
          distance: hit.distance,
          anchor_element_id: hit.anchor_element_id,
          image_src: hit.image_src,
          text: hit.text,
        });
      }
    }
    // Resolve live image src / graph text for thumbnails.
    for (const row of byId.values()) {
      if (row.element_type === 'image' && !row.image_src) {
        const live = elements.find((e) => e.id === row.element_id);
        if (live && live.type === 'image') row.image_src = live.src;
      }
      if (row.element_type === 'graph' && !row.text) {
        const live = elements.find((e) => e.id === row.element_id);
        if (live && live.type === 'graph') {
          row.text = live.expressions.map((e) => e.sourceText || e.id).join(', ');
        }
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => a.distance - b.distance || a.element_id.localeCompare(b.element_id),
    );
  }, [spatialHits, elements]);

  const busy = retrieving || sending || expanding;
  const manual = llmExecutionMode === 'manual';
  const canBuildPrompt = prompt.trim().length > 0;
  const canSendAutomatic = canBuildPrompt && !busy && !manual;

  return (
    <>
      <button
        type="button"
        className="rag-debug-toggle"
        onClick={() => togglePanel()}
        title="RAG debug panel (development)"
      >
        RAG
      </button>

      {open && (
        <aside
          className="rag-debug-panel"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <header className="rag-debug-header">
            <div>
              <strong>RAG Debug</strong>
              <span className="rag-debug-sub">
                {manual ? 'manual LLM mode — no API credits' : 'automatic LLM API mode'}
              </span>
            </div>
            <button type="button" className="rag-debug-icon-btn" onClick={closePanel} aria-label="Close">
              ×
            </button>
          </header>

          <section className="rag-debug-section rag-debug-mode">
            <div className="rag-debug-section-title">LLM execution</div>
            <div className="rag-debug-shortcuts">
              <button
                type="button"
                className={`rag-debug-btn ghost${manual ? ' is-active' : ''}`}
                onClick={() => setLlmExecutionMode('manual')}
              >
                Manual
              </button>
              <button
                type="button"
                className={`rag-debug-btn ghost${!manual ? ' is-active' : ''}`}
                onClick={() => setLlmExecutionMode('automatic')}
              >
                Automatic
              </button>
            </div>
            {manual && (
              <p className="rag-debug-meta">
                Copy the full prompt into ChatGPT, then paste the reply back. Zero paid LLM calls.
              </p>
            )}
          </section>

          <StructureSelector
            id="rag-debug-structure"
            className="structure-selector rag-debug-structure"
            disabled={busy}
          />

          <label className="rag-debug-label" htmlFor="rag-debug-prompt">
            User prompt
          </label>
          <textarea
            id="rag-debug-prompt"
            className="rag-debug-textarea"
            rows={2}
            value={prompt}
            disabled={busy}
            placeholder="Explain why Gauss's law is useful for spherical symmetry."
            onChange={(e) => setPrompt(e.target.value)}
          />

          <div className="rag-debug-row">
            <button
              type="button"
              className="rag-debug-btn primary"
              disabled={!prompt.trim() || busy}
              onClick={() => void retrieve()}
            >
              {retrieving ? 'Retrieving…' : 'Retrieve'}
            </button>
            {lastRetrieveMeta && (
              <span className="rag-debug-meta">
                {lastQueryChunks} query chunk(s) · {lastRetrieveMeta.embedding_model}
              </span>
            )}
          </div>

          <p className="rag-debug-summary-strip">
            selected {context.stats.explicit_selection_count}
            {' · '}
            anchors {context.stats.semantic_anchor_count}
            {' · '}
            spatial {context.stats.spatial_addition_count}
            {' · '}
            images {context.stats.image_attachment_count}
            {' · '}
            semantic+ {context.stats.unique_semantic_addition_count}
            {' · '}
            total {context.stats.total_unique_elements}
          </p>

          <nav className="rag-debug-tabs" aria-label="RAG debug pages">
            {RAG_DEBUG_PAGES.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`rag-debug-tab${page === tab.id ? ' is-active' : ''}`}
                onClick={() => setPage(tab.id)}
                aria-current={page === tab.id ? 'page' : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="rag-debug-page" role="tabpanel">
            {page === 'selected' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">
                  Explicit canvas selection
                </div>
                <p className="rag-debug-meta">
                  Captured from the editor selection when you Retrieve / Copy /
                  Send. Distinct from RAG semantic-anchor checkboxes. Always
                  included in context — no extra checkbox. Does not trigger
                  spatial or semantic expansion.
                </p>
                <p className="rag-debug-meta">
                  Captured for this prompt:{' '}
                  <strong>{explicitSelectionIds.length}</strong>
                  {' · '}
                  Live editor selection: <strong>{liveEditorSelectedIds.length}</strong>
                </p>
                {context.explicitlySelectedElements.length === 0 ? (
                  <p className="rag-debug-empty">
                    No editor selection captured yet. Select canvas elements,
                    then Retrieve (or Copy LLM prompt).
                  </p>
                ) : (
                  <ul className="rag-debug-list">
                    {context.explicitlySelectedElements.map((el) => (
                      <li key={el.element_id} className="rag-debug-item is-selected">
                        <div className="rag-debug-row tight">
                          <input type="checkbox" checked readOnly disabled />
                          <span className="rag-debug-badge explicit_selection">
                            explicit_selection
                          </span>
                          <span className="rag-debug-id">{el.element_id}</span>
                          <span className="rag-debug-meta">{el.element_type}</span>
                        </div>
                        <p className="rag-debug-preview">
                          {previewText(el.text || '(no readable content)', 100)}
                        </p>
                        <p className="rag-debug-meta">Automatically included: Yes</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {page === 'structure' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">
                  SELECTED NOTE STRUCTURE
                </div>
                <p className="rag-debug-meta">
                  Output format for this request — separate from canvas / interaction /
                  semantic / spatial knowledge context. Snapshotted at Retrieve / Copy /
                  Preview. Live dropdown:{' '}
                  <strong>
                    {liveStructureId
                      ? structures.find((s) => s.id === liveStructureId)?.name ??
                        liveStructureId
                      : 'No Structure'}
                  </strong>
                </p>
                {!selectedStructureId ? (
                  <pre className="rag-debug-plan">{formatNoStructureSelected()}</pre>
                ) : snapshottedStructure ? (
                  <pre className="rag-debug-plan">
                    {formatNoteStructureForPrompt(snapshottedStructure)}
                  </pre>
                ) : (
                  <p className="rag-debug-empty">
                    Structure id <code>{selectedStructureId}</code> was snapshotted but
                    is no longer in the library (deleted after snapshot).
                  </p>
                )}
              </section>
            )}

            {page === 'intent' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">Prompt intent</div>
                {!promptIntent ? (
                  <p className="rag-debug-empty">
                    No classification yet. Run Retrieve (2-way: Spatial / Interaction —
                    observational only; does not change retrieval).
                  </p>
                ) : (
                  <>
                    <p className="rag-debug-intent-winner">
                      Classified as:{' '}
                      <strong>
                        {promptIntent.scores.find(
                          (s) => s.intent === promptIntent.classified_intent,
                        )?.display_name ?? promptIntent.classified_intent}
                      </strong>
                    </p>
                    <p className="rag-debug-meta">
                      Similarity margin (1st − 2nd):{' '}
                      <strong>{promptIntent.score_margin.toFixed(3)}</strong>
                      {' · '}
                      {promptIntent.embedding_model}
                    </p>
                    <ol className="rag-debug-list rag-debug-intent-list">
                      {promptIntent.scores.map((score, index) => {
                        const isWinner =
                          score.intent === promptIntent.classified_intent;
                        const matches = score.top_matches ?? [];
                        return (
                          <li
                            key={score.intent}
                            className={`rag-debug-item${isWinner ? ' is-selected' : ''}`}
                          >
                            <div className="rag-debug-row tight">
                              <span className="rag-debug-intent-rank">
                                {index + 1}.
                              </span>
                              <span className="rag-debug-score">
                                {score.similarity.toFixed(3)}
                              </span>
                              <span className="rag-debug-id">{score.display_name}</span>
                              {isWinner && (
                                <span className="rag-debug-badge both">winner</span>
                              )}
                            </div>
                            {matches.length > 0 && (
                              <details
                                className="rag-debug-intent-proto"
                                open={isWinner}
                              >
                                <summary>
                                  Top matches (k=
                                  {promptIntent.exemplar_top_k ?? matches.length})
                                </summary>
                                <ul className="rag-debug-exemplar-list">
                                  {matches.map((m) => (
                                    <li key={`${score.intent}-${m.text}`}>
                                      <span className="rag-debug-score">
                                        {m.similarity.toFixed(3)}
                                      </span>{' '}
                                      <span className="rag-debug-exemplar-text">
                                        &ldquo;{m.text}&rdquo;
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </>
                )}
              </section>
            )}

            {page === 'matches' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">Prompt semantic matches</div>
                <div className="rag-debug-shortcuts">
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    disabled={!candidates.length}
                    onClick={() => selectTopN(1)}
                  >
                    Top 1
                  </button>
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    disabled={!candidates.length}
                    onClick={() => selectTopN(3)}
                  >
                    Top 3
                  </button>
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    disabled={!candidates.length}
                    onClick={() => selectTopN(5)}
                  >
                    Top 5
                  </button>
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    disabled={!selectedAnchorIds.length}
                    onClick={clearAnchors}
                  >
                    Clear
                  </button>
                </div>

                {candidates.length === 0 ? (
                  <p className="rag-debug-empty">No candidates yet. Run Retrieve.</p>
                ) : (
                  <ul className="rag-debug-list">
                    {candidates.map((c) => {
                      const checked = selectedSet.has(c.element_id);
                      const preview = c.matched_chunks[0]?.text ?? '';
                      const isHw = c.element_type === 'handwriting_region';
                      const hwRec = isHw
                        ? resolveHandwritingRecognition(c.element_id)
                        : null;
                      return (
                        <li
                          key={c.element_id}
                          className={`rag-debug-item${checked ? ' is-selected' : ''}`}
                        >
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAnchor(c.element_id)}
                            />
                            <span className="rag-debug-score">
                              {c.score.toFixed(3)}
                            </span>
                            <span className="rag-debug-badge spatial">
                              {isHw ? 'HandwritingRegion' : c.element_type || 'TextElement'}
                            </span>
                            <span className="rag-debug-id">{c.element_id}</span>
                          </label>
                          <p className="rag-debug-preview">
                            {isHw ? `OCR: ${previewText(preview)}` : previewText(preview)}
                          </p>
                          {isHw && hwRec?.regionImageDataUrl && (
                            <img
                              className="rag-debug-thumb"
                              src={hwRec.regionImageDataUrl}
                              alt=""
                              title={c.element_id}
                            />
                          )}
                          <p className="rag-debug-meta">
                            {c.matched_chunks.length} matched chunk(s)
                            {c.matched_chunks[0] != null
                              ? ` · best chunk #${c.matched_chunks[0].chunk_index}`
                              : ''}
                            {isHw
                              ? ` · bounds x=${c.geometry.x.toFixed(0)},y=${c.geometry.y.toFixed(0)}`
                              : ''}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {page === 'spatial' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">Spatial expansion</div>
                <label className="rag-debug-check">
                  <input
                    type="checkbox"
                    checked={spatialExpansionEnabled}
                    onChange={(e) => setSpatialExpansionEnabled(e.target.checked)}
                  />
                  Enabled
                </label>
                <p className="rag-debug-meta">
                  Expand around selected prompt-semantic anchors by AABB distance.
                  Includes text, equation, and image elements (images have no
                  embeddings — spatial only).
                </p>
                <div className="rag-debug-section-title">
                  Radius{' '}
                  <span className="rag-debug-radius-value">{radius} world units</span>
                </div>
                <input
                  type="range"
                  className="rag-debug-slider"
                  min={RAG_SPATIAL_RADIUS_MIN}
                  max={RAG_SPATIAL_RADIUS_MAX}
                  step={RAG_SPATIAL_RADIUS_STEP}
                  value={radius}
                  disabled={!spatialExpansionEnabled}
                  onChange={(e) => setRadius(Number(e.target.value))}
                />
                <div className="rag-debug-row">
                  <input
                    type="number"
                    className="rag-debug-number"
                    min={RAG_SPATIAL_RADIUS_MIN}
                    max={RAG_SPATIAL_RADIUS_MAX}
                    step={RAG_SPATIAL_RADIUS_STEP}
                    value={radius}
                    disabled={!spatialExpansionEnabled}
                    onChange={(e) => setRadius(Number(e.target.value) || 0)}
                  />
                  <span className="rag-debug-meta">
                    {spatialExpansionEnabled
                      ? '0 = no spatial neighbours'
                      : 'Spatial expansion off'}
                  </span>
                </div>
                <p className="rag-debug-meta">
                  Spatial additions in context:{' '}
                  <strong>{context.stats.spatial_addition_count}</strong>
                  {' · text '}
                  <strong>{context.stats.spatial_text_addition_count}</strong>
                  {' · eq '}
                  <strong>{context.stats.spatial_equation_addition_count}</strong>
                  {' · img '}
                  <strong>{context.stats.spatial_image_addition_count}</strong>
                  {' · graph '}
                  <strong>{context.stats.spatial_graph_addition_count}</strong>
                  {' · '}
                  anchors selected: <strong>{selectedAnchorIds.length}</strong>
                </p>

                {spatialExpansionEnabled && (
                  <>
                    <div className="rag-debug-shortcuts">
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={spatialHitRows.length === 0}
                        onClick={() => selectAllSpatialHits()}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={spatialHitRows.length === 0}
                        onClick={() => clearSpatialSelection()}
                      >
                        Clear
                      </button>
                    </div>
                    {spatialHitRows.length === 0 ? (
                      <p className="rag-debug-meta">
                        No spatial neighbours yet. Select semantic anchors and ensure
                        radius &gt; 0.
                      </p>
                    ) : (
                      <ul className="rag-debug-list compact">
                        {spatialHitRows.map((row) => {
                          const checked = !spatialExcludedSet.has(row.element_id);
                          return (
                            <li key={row.element_id} className="rag-debug-item">
                              <label className="rag-debug-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleSpatialIncluded(row.element_id)
                                  }
                                />
                                <span className="rag-debug-badge spatial">
                                  {row.element_type}
                                </span>
                                <span className="rag-debug-id">{row.element_id}</span>
                                <span className="rag-debug-meta">
                                  distance {row.distance.toFixed(1)}
                                </span>
                              </label>
                              <p className="rag-debug-meta">
                                Anchor: {row.anchor_element_id}
                              </p>
                              {row.element_type === 'image' && row.image_src && (
                                <img
                                  className="rag-debug-thumb"
                                  src={row.image_src}
                                  alt=""
                                  title={row.element_id}
                                />
                              )}
                              {row.element_type === 'graph' && (
                                <pre className="rag-debug-pre compact">
                                  {(row.text || '(graph)').slice(0, 400)}
                                  {(row.text?.length ?? 0) > 400 ? '…' : ''}
                                </pre>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </section>
            )}

            {page === 'semantic' && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">
                  Semantic / knowledge expansion
                </div>
                <label className="rag-debug-check">
                  <input
                    type="checkbox"
                    checked={semanticExpansionEnabled}
                    onChange={(e) => setSemanticExpansionEnabled(e.target.checked)}
                  />
                  Enabled
                </label>
                <p className="rag-debug-meta">
                  Anchor element → related canvas elements (not prompt re-retrieve).
                  Supported: text, equation. Off by default — never applied silently.
                </p>

                <div className="rag-debug-row tight">
                  <span className="rag-debug-meta">Depth:</span>
                  {[0, 1, 2].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`rag-debug-btn ghost${semanticExpansionDepth === d ? ' is-active' : ''}`}
                      disabled={!semanticExpansionEnabled}
                      onClick={() => setSemanticExpansionDepth(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div className="rag-debug-row">
                  <label className="rag-debug-label" htmlFor="rag-sem-max-n">
                    Max neighbours
                  </label>
                  <input
                    id="rag-sem-max-n"
                    type="number"
                    className="rag-debug-number"
                    min={RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MIN}
                    max={RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MAX}
                    value={semanticMaxNeighbours}
                    disabled={!semanticExpansionEnabled}
                    onChange={(e) =>
                      setSemanticMaxNeighbours(Number(e.target.value) || 1)
                    }
                  />
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    disabled={
                      !semanticExpansionEnabled ||
                      selectedAnchorIds.length === 0 ||
                      expanding
                    }
                    onClick={() => void refreshSemanticExpansion()}
                  >
                    {expanding ? 'Expanding…' : 'Refresh'}
                  </button>
                </div>

                {semanticExpansionEnabled && (
                  <>
                    <div className="rag-debug-shortcuts">
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={!semanticExpandResponse}
                        onClick={selectAllSemanticExpansion}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={!semanticIncludedIds.length}
                        onClick={clearSemanticExpansionSelection}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={!semanticExpandResponse}
                        onClick={() => selectTopSemanticExpansion(1)}
                      >
                        Top 1
                      </button>
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={!semanticExpandResponse}
                        onClick={() => selectTopSemanticExpansion(3)}
                      >
                        Top 3
                      </button>
                      <button
                        type="button"
                        className="rag-debug-btn ghost"
                        disabled={!semanticExpandResponse}
                        onClick={() => selectTopSemanticExpansion(5)}
                      >
                        Top 5
                      </button>
                    </div>

                    {semanticExpansionDepth === 0 ? (
                      <p className="rag-debug-empty">
                        Depth 0 — no semantic neighbours.
                      </p>
                    ) : selectedAnchorIds.length === 0 ? (
                      <p className="rag-debug-empty">
                        Select prompt semantic anchors on the Matches page first.
                      </p>
                    ) : expanding ? (
                      <p className="rag-debug-empty">Expanding…</p>
                    ) : semanticTrees.length === 0 ? (
                      <p className="rag-debug-empty">
                        No expansion graph yet. Enable + select anchors
                        (auto-refreshes).
                      </p>
                    ) : (
                      <ul className="rag-debug-tree rag-debug-tree-root">
                        {semanticTrees.map((tree) => (
                          <SemanticTreeBranch
                            key={tree.element_id}
                            node={tree}
                            included={includedSet}
                            collapsedKeys={collapsedSet}
                            onToggleInclude={toggleSemanticIncluded}
                            onToggleBranch={toggleSemanticBranch}
                          />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            )}

            {page === 'handwriting' && (
              <>
                <section className="rag-debug-section">
                  <div className="rag-debug-section-title">
                    Handwriting region detection
                  </div>
                  <p className="rag-debug-meta">
                    Geometric grouping of pen strokes into lines → regions (world
                    coordinates), then local TrOCR + EmbeddingGemma for semantic RAG.
                    Overlays are transient and not stored in CanvasDocument.
                  </p>
                  <label className="rag-debug-check">
                    <input
                      type="checkbox"
                      checked={hwShowRegions}
                      onChange={(e) => {
                        setHwShowRegions(e.target.checked);
                        if (e.target.checked) ensureHwDetection({ force: true });
                      }}
                    />
                    Show handwriting regions
                  </label>
                  <label className="rag-debug-check">
                    <input
                      type="checkbox"
                      checked={hwShowLines}
                      onChange={(e) => {
                        setHwShowLines(e.target.checked);
                        if (e.target.checked) ensureHwDetection({ force: true });
                      }}
                    />
                    Show handwriting lines
                  </label>
                  <div className="rag-debug-row">
                    <button
                      type="button"
                      className="rag-debug-btn"
                      onClick={() => refreshHwDetection()}
                    >
                      Refresh detection
                    </button>
                    <button
                      type="button"
                      className="rag-debug-btn ghost"
                      onClick={() => resetHwConfig()}
                    >
                      Reset thresholds
                    </button>
                  </div>
                </section>

                <section className="rag-debug-section rag-debug-counts">
                  <div className="rag-debug-section-title">Detection statistics</div>
                  <div>
                    Total strokes: <strong>{hwResult.scale.totalStrokeCount}</strong>
                  </div>
                  <div>
                    Detected lines: <strong>{hwResult.lines.length}</strong>
                  </div>
                  <div>
                    Detected regions: <strong>{hwResult.regions.length}</strong>
                  </div>
                  <div>
                    Typical stroke height:{' '}
                    <strong>{hwResult.scale.typicalStrokeHeight.toFixed(1)}</strong>
                  </div>
                  <div>
                    Typical stroke width:{' '}
                    <strong>{hwResult.scale.typicalStrokeWidth.toFixed(1)}</strong>
                  </div>
                  <div>
                    Median line height:{' '}
                    <strong>{hwResult.scale.medianLineHeight.toFixed(1)}</strong>
                  </div>
                  <div className="rag-debug-meta">
                    Scale from {hwResult.scale.strokeCountUsedForScale} stroke(s)
                    (outliers excluded)
                  </div>
                </section>

                <section className="rag-debug-section">
                  <div className="rag-debug-section-title">Thresholds</div>
                  {(
                    [
                      ['lineVerticalTolerance', 'Line vertical tolerance', 0.1, 2, 0.05],
                      ['maxHorizontalGapForLine', 'Horizontal line gap', 0.5, 8, 0.1],
                      ['maxVerticalGapForRegion', 'Region vertical gap', 0.3, 4, 0.1],
                      [
                        'minHorizontalOverlapRatio',
                        'Min horizontal overlap',
                        0,
                        1,
                        0.05,
                      ],
                      ['alignmentTolerance', 'Alignment tolerance', 0.2, 4, 0.1],
                      ['smallMarkThreshold', 'Small-mark threshold', 0.1, 1, 0.05],
                      ['regionPadding', 'Region padding', 0, 1.5, 0.05],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <label key={key} className="rag-debug-label">
                      {label}: {hwConfig[key].toFixed(2)}
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={hwConfig[key]}
                        onChange={(e) => {
                          setHwConfigPatch({ [key]: Number(e.target.value) });
                          if (!hwShowRegions && !hwShowLines) {
                            ensureHwDetection({ force: true });
                          }
                        }}
                      />
                    </label>
                  ))}
                  <p className="rag-debug-meta">
                    Defaults: vTol=
                    {DEFAULT_HANDWRITING_REGION_CONFIG.lineVerticalTolerance}, hGap=
                    {DEFAULT_HANDWRITING_REGION_CONFIG.maxHorizontalGapForLine}, rGap=
                    {DEFAULT_HANDWRITING_REGION_CONFIG.maxVerticalGapForRegion}
                  </p>
                </section>

                <section className="rag-debug-section">
                  <div className="rag-debug-section-title">
                    TrOCR recognition + indexing
                  </div>
                  <p className="rag-debug-meta">
                    Local microsoft/trocr-base-handwritten per line → combined text →
                    EmbeddingGemma. OCR is for retrieval; LLM gets the original stroke
                    image. Derived only — CanvasDocument strokes stay canonical.
                  </p>
                  <div className="rag-debug-row">
                    <button
                      type="button"
                      className="rag-debug-btn"
                      onClick={() => {
                        void handwritingRecognitionController.refreshAll();
                      }}
                    >
                      Reindex handwriting
                    </button>
                    <button
                      type="button"
                      className="rag-debug-btn ghost"
                      onClick={() => {
                        ensureHwDetection({ force: true });
                        void handwritingRecognitionController.refreshAll();
                      }}
                    >
                      Detect + re-recognize all
                    </button>
                  </div>
                  {hwRecognitionRecords.length === 0 ? (
                    <p className="rag-debug-empty">
                      No recognition records yet. Draw with the Pen tool, wait for
                      debounce, or click Reindex.
                    </p>
                  ) : (
                    <ul className="rag-debug-list compact">
                      {hwRecognitionRecords.map((rec) => (
                        <li key={rec.ragElementId} className="rag-debug-item">
                          <div className="rag-debug-row tight">
                            <span className="rag-debug-badge spatial">
                              {rec.regionId}
                            </span>
                            <span className="rag-debug-id">{rec.ragElementId}</span>
                            <span className="rag-debug-meta">{rec.status}</span>
                          </div>
                          <p className="rag-debug-meta">
                            Lines: {rec.lineResults.length} · Embedding:{' '}
                            {rec.embeddingIndexed ? 'ready' : 'none'} · Model:{' '}
                            {rec.recognizerModel || '(pending)'}
                          </p>
                          {rec.lineResults.map((lr) => (
                            <p key={lr.lineId} className="rag-debug-meta">
                              {lr.lineId}: &quot;{lr.recognizedText || '(empty)'}&quot;
                              {lr.status !== 'ready' ? ` [${lr.status}]` : ''}
                            </p>
                          ))}
                          <p className="rag-debug-preview">
                            Combined: {rec.recognizedText || '(none)'}
                          </p>
                          {rec.regionImageDataUrl && (
                            <img
                              className="rag-debug-thumb"
                              src={rec.regionImageDataUrl}
                              alt=""
                              title={rec.ragElementId}
                            />
                          )}
                          {rec.error && (
                            <p className="rag-debug-meta">Error: {rec.error}</p>
                          )}
                          <button
                            type="button"
                            className="rag-debug-btn ghost"
                            onClick={() => {
                              void handwritingRecognitionController.reRecognizeRegion(
                                rec.ragElementId,
                              );
                            }}
                          >
                            Re-run recognition
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rag-debug-section">
                  <div className="rag-debug-section-title">Regions</div>
                  {hwResult.regions.length === 0 ? (
                    <p className="rag-debug-empty">
                      No handwriting regions. Draw with the Pen tool, then Refresh.
                    </p>
                  ) : (
                    <ul className="rag-debug-list compact">
                      {hwResult.regions.map((r) => {
                        const ragId = stableHandwritingRegionId(r.strokeIds);
                        const rec = resolveHandwritingRecognition(ragId);
                        return (
                        <li
                          key={r.id}
                          className={`rag-debug-item${
                            hwSelectedRegionId === r.id ? ' is-selected' : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="rag-debug-row tight"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              width: '100%',
                              textAlign: 'left',
                            }}
                            onClick={() => {
                              selectHwRegion(r.id);
                              if (!hwShowRegions) setHwShowRegions(true);
                            }}
                          >
                            <span className="rag-debug-badge spatial">{r.id}</span>
                            <span className="rag-debug-meta">
                              {r.lineCount} lines · {r.strokeCount} strokes
                              {rec ? ` · OCR ${rec.status}` : ''}
                            </span>
                          </button>
                          <p className="rag-debug-meta">
                            Bounds: x={r.rawBounds.x.toFixed(1)}, y=
                            {r.rawBounds.y.toFixed(1)}, w=
                            {r.rawBounds.width.toFixed(1)}, h=
                            {r.rawBounds.height.toFixed(1)}
                          </p>
                          {rec?.recognizedText && (
                            <p className="rag-debug-preview">
                              OCR: {previewText(rec.recognizedText, 100)}
                            </p>
                          )}
                          {hwSelectedRegionId === r.id && (
                            <>
                              <p className="rag-debug-meta">
                                Lines: {r.lineIds.join(', ')}
                              </p>
                              <p className="rag-debug-meta">
                                Strokes: {r.strokeIds.join(', ')}
                              </p>
                              <p className="rag-debug-meta">RAG id: {ragId}</p>
                            </>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="rag-debug-section">
                  <div className="rag-debug-section-title">Lines</div>
                  {hwResult.lines.length === 0 ? (
                    <p className="rag-debug-empty">No lines detected.</p>
                  ) : (
                    <ul className="rag-debug-list compact">
                      {hwResult.lines.map((line) => (
                        <li
                          key={line.id}
                          className={`rag-debug-item${
                            hwSelectedLineId === line.id ? ' is-selected' : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="rag-debug-row tight"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              width: '100%',
                              textAlign: 'left',
                            }}
                            onClick={() => {
                              selectHwLine(line.id);
                              if (!hwShowLines) setHwShowLines(true);
                            }}
                          >
                            <span className="rag-debug-badge both">{line.id}</span>
                            <span className="rag-debug-meta">
                              {line.strokeIds.length} strokes
                            </span>
                          </button>
                          <p className="rag-debug-meta">
                            y={line.centerY.toFixed(1)} · h=
                            {line.height.toFixed(1)} · strokes L→R:{' '}
                            {line.strokeIdsLeftToRight.join(', ')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}

            {page === 'context' && (
              <>
                <section className="rag-debug-section rag-debug-counts">
                  <div className="rag-debug-section-title">Final context</div>
                  <div>
                    Explicit selection:{' '}
                    <strong>{context.stats.explicit_selection_count}</strong>
                  </div>
                  <div>
                    Semantic anchors:{' '}
                    <strong>{context.stats.semantic_anchor_count}</strong>
                  </div>
                  <div>
                    Spatial additions:{' '}
                    <strong>{context.stats.spatial_addition_count}</strong>
                    {' (text '}
                    {context.stats.spatial_text_addition_count}
                    {' · eq '}
                    {context.stats.spatial_equation_addition_count}
                    {' · img '}
                    {context.stats.spatial_image_addition_count}
                    {' · graph '}
                    {context.stats.spatial_graph_addition_count}
                    )
                  </div>
                  <div>
                    Image attachments:{' '}
                    <strong>{context.stats.image_attachment_count}</strong>
                    {context.stats.region_image_attachment_count > 0 && (
                      <>
                        {' · region '}
                        <strong>{context.stats.region_image_attachment_count}</strong>
                      </>
                    )}
                    {context.stats.image_budget_excluded_count > 0 && (
                      <>
                        {' · budget-excluded '}
                        <strong>{context.stats.image_budget_excluded_count}</strong>
                      </>
                    )}
                  </div>
                  <div>
                    Semantic depth-1 additions:{' '}
                    <strong>{context.stats.semantic_depth1_addition_count}</strong>
                  </div>
                  <div>
                    Semantic depth-2 additions:{' '}
                    <strong>{context.stats.semantic_depth2_addition_count}</strong>
                  </div>
                  <div>
                    Unique semantic additions:{' '}
                    <strong>{context.stats.unique_semantic_addition_count}</strong>
                  </div>
                  <div>
                    Total unique canvas elements:{' '}
                    <strong>{context.stats.total_unique_elements}</strong>
                  </div>
                  <div>
                    ~{context.stats.word_count} words ·{' '}
                    {context.stats.character_count} chars
                  </div>
                  <div className="rag-debug-meta">
                    Budget: {RAG_MAX_CONTEXT_ELEMENTS} elements /{' '}
                    {RAG_MAX_CONTEXT_CHARACTERS} chars / {RAG_MAX_CONTEXT_IMAGES}{' '}
                    images
                    {(context.stats.truncated_by_element_budget ||
                      context.stats.truncated_by_character_budget ||
                      context.stats.truncated_by_image_budget) &&
                      ' · truncated'}
                    {context.stats.required_context_exceeds_budget &&
                      ' · required explicit/anchor context exceeds budget (kept)'}
                  </div>
                </section>

                {(explicitRegionInspection || explicitRegionBounds) && (
                  <section className="rag-debug-section">
                    <div className="rag-debug-section-title">SELECTED REGION</div>
                    {explicitRegionInspection?.kind === 'empty' ? (
                      <>
                        <p className="rag-debug-meta">
                          Selected region contains no meaningful canvas content.
                        </p>
                        <p className="rag-debug-meta">Image attachment: No</p>
                      </>
                    ) : (
                      <>
                        {explicitRegionBounds && (
                          <p className="rag-debug-meta">
                            Bounds: x={explicitRegionBounds.x.toFixed(1)}, y=
                            {explicitRegionBounds.y.toFixed(1)}, width=
                            {explicitRegionBounds.width.toFixed(1)}, height=
                            {explicitRegionBounds.height.toFixed(1)}
                          </p>
                        )}
                        <p className="rag-debug-meta">
                          Structured elements:{' '}
                          {explicitRegionInspection?.structuredElementIds.length
                            ? explicitRegionInspection.structuredElementIds.join(', ')
                            : '(none)'}
                        </p>
                        <p className="rag-debug-meta">
                          Visual content detected:{' '}
                          {explicitRegionInspection?.hasVisualContent ? 'Yes' : 'No'}
                        </p>
                        {explicitRegionInspection?.kind === 'structured_only' ? (
                          <p className="rag-debug-meta">
                            Image attachment: No — structured text only
                          </p>
                        ) : explicitRegionInspection?.shouldRenderImage ? (
                          <>
                            <p className="rag-debug-meta">
                              Image attachment:{' '}
                              {explicitRegionImageSrc ? 'Yes' : 'Required (pending/failed)'}
                            </p>
                            {explicitRegionImageSrc && (
                              <img
                                className="rag-debug-thumb"
                                src={explicitRegionImageSrc}
                                alt="Selected canvas region"
                                title="Selected canvas region"
                              />
                            )}
                          </>
                        ) : (
                          <p className="rag-debug-meta">Image attachment: No</p>
                        )}
                      </>
                    )}
                  </section>
                )}

                {context.imageAttachments.length > 0 && (
                  <section className="rag-debug-section">
                    <div className="rag-debug-section-title">
                      IMAGE ATTACHMENTS
                      {manual ? ' (required for manual mode)' : ''}
                    </div>
                    <p className="rag-debug-meta">
                      Actual image bytes are not copied into the clipboard prompt.
                      Attach these images alongside the copied text when using an
                      external chat UI.
                    </p>
                    <ul className="rag-debug-list compact">
                      {context.imageAttachments.map((att) => (
                        <li key={`img-${att.element_id}`} className="rag-debug-item">
                          <div className="rag-debug-row tight">
                            <span className="rag-debug-badge spatial">
                              {att.element_type === 'region'
                                ? 'region'
                                : att.element_type === 'handwriting_region'
                                  ? 'handwriting'
                                  : 'image'}
                            </span>
                            <span className="rag-debug-id">{att.element_id}</span>
                          </div>
                          <p className="rag-debug-meta">
                            Reason: {att.selection_reason}
                            {att.nearest_distance != null
                              ? ` · d=${att.nearest_distance.toFixed(1)}`
                              : ''}
                          </p>
                          {(att.selection_reason === 'explicit_region_selection' ||
                            att.selection_reason === 'semantic_handwriting') && (
                            <p className="rag-debug-meta">
                              Status: Attachment required
                              {att.region?.included_element_ids?.length
                                ? ` · includes ${att.region.included_element_ids.join(', ')}`
                                : ''}
                            </p>
                          )}
                          {att.ocr_transcription && (
                            <p className="rag-debug-preview">
                              OCR (retrieval only): {previewText(att.ocr_transcription, 100)}
                            </p>
                          )}
                          {att.sources
                            .filter((s) => s.type === 'spatial')
                            .map((s) =>
                              s.type === 'spatial' ? (
                                <p
                                  key={`ia-${s.anchor_element_id}-${s.distance}`}
                                  className="rag-debug-meta"
                                >
                                  spatial neighbor of {s.anchor_element_id} (distance{' '}
                                  {s.distance.toFixed(1)})
                                </p>
                              ) : null,
                            )}
                          <img
                            className="rag-debug-thumb"
                            src={att.asset_src}
                            alt=""
                            title={att.element_id}
                          />
                          <a
                            className="rag-debug-meta"
                            href={att.asset_src}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open image
                          </a>
                        </li>
                      ))}
                    </ul>
                    {context.stats.image_budget_excluded_ids.length > 0 && (
                      <p className="rag-debug-meta">
                        Excluded by image budget (
                        {RAG_MAX_CONTEXT_IMAGES}):{' '}
                        {context.stats.image_budget_excluded_ids.join(', ')}
                      </p>
                    )}
                  </section>
                )}

                <div className="rag-debug-row">
                  <button
                    type="button"
                    className="rag-debug-btn"
                    disabled={context.stats.total_unique_elements === 0}
                    onClick={() => setPreviewOpen(!previewOpen)}
                  >
                    {previewOpen ? 'Hide context' : 'Preview context'}
                  </button>
                  <button
                    type="button"
                    className="rag-debug-btn"
                    disabled={!canBuildPrompt}
                    onClick={() => setLlmPromptPreviewOpen(!llmPromptPreviewOpen)}
                  >
                    {llmPromptPreviewOpen ? 'Hide LLM prompt' : 'Preview LLM prompt'}
                  </button>
                </div>

                <div className="rag-debug-row">
                  <button
                    type="button"
                    className="rag-debug-btn primary"
                    disabled={!canBuildPrompt}
                    onClick={() => void copyLlmPrompt()}
                  >
                    Copy LLM prompt
                  </button>
                  <button
                    type="button"
                    className="rag-debug-btn primary"
                    onClick={openResponseModal}
                  >
                    Paste LLM response
                  </button>
                </div>

                <div className="rag-debug-row">
                  <button
                    type="button"
                    className="rag-debug-btn ghost"
                    onClick={() => void copyRetrievalDebugData()}
                  >
                    Copy retrieval debug JSON
                  </button>
                  {!manual && (
                    <button
                      type="button"
                      className="rag-debug-btn"
                      disabled={!canSendAutomatic}
                      onClick={() => void sendWithContext()}
                      title="Calls the backend LLM API (uses credits)"
                    >
                      {sending ? 'Sending…' : 'Send with context (API)'}
                    </button>
                  )}
                </div>

                {previewOpen && (
                  <section className="rag-debug-section">
                    <div className="rag-debug-section-title">Context preview</div>
                    {context.explicitlySelectedElements.length > 0 && (
                      <>
                        <div className="rag-debug-section-title">
                          Explicitly selected canvas elements
                        </div>
                        <ul className="rag-debug-list compact">
                          {context.explicitlySelectedElements.map((el) => (
                            <li key={`ex-${el.element_id}`} className="rag-debug-item">
                              <div className="rag-debug-row tight">
                                <span className="rag-debug-badge explicit_selection">
                                  explicit_selection
                                </span>
                                <span className="rag-debug-id">{el.element_id}</span>
                              </div>
                              <p className="rag-debug-meta">
                                SOURCES: {el.sources.map((s) => s.type).join(', ')}
                              </p>
                              <p className="rag-debug-preview">
                                {previewText(el.text, 100)}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="rag-debug-section-title">
                      Retrieved supporting context
                    </div>
                    <ul className="rag-debug-list compact">
                      {context.allElements
                        .filter(
                          (el) =>
                            !el.sources.some((s) => s.type === 'explicit_selection'),
                        )
                        .map((el) => {
                        const neigh = el.sources.filter(
                          (s) => s.type === 'semantic_neighbor',
                        );
                        const spatial = el.sources.filter((s) => s.type === 'spatial');
                        return (
                          <li key={el.element_id} className="rag-debug-item">
                            <div className="rag-debug-row tight">
                              <span className={`rag-debug-badge ${el.inclusion}`}>
                                {el.inclusion}
                              </span>
                              <span className="rag-debug-id">{el.element_id}</span>
                              {el.similarity != null && (
                                <span className="rag-debug-score">
                                  {el.similarity.toFixed(3)}
                                </span>
                              )}
                              {el.nearest_distance != null && (
                                <span className="rag-debug-meta">
                                  d={el.nearest_distance.toFixed(1)}
                                </span>
                              )}
                            </div>
                            <p className="rag-debug-meta">
                              SOURCES: {el.sources.map((s) => s.type).join(', ')}
                            </p>
                            {spatial.map((s) =>
                              s.type === 'spatial' ? (
                                <p
                                  key={`sp-${s.anchor_element_id}`}
                                  className="rag-debug-meta"
                                >
                                  SPATIAL: anchor {s.anchor_element_id} · distance{' '}
                                  {s.distance.toFixed(1)}
                                </p>
                              ) : null,
                            )}
                            {neigh.map((s) =>
                              s.type === 'semantic_neighbor' ? (
                                <p
                                  key={`sn-${s.root_anchor_element_id}-${s.parent_element_id}-${s.depth}`}
                                  className="rag-debug-meta"
                                >
                                  SEMANTIC: root {s.root_anchor_element_id} · parent{' '}
                                  {s.parent_element_id} · depth {s.depth} · sim{' '}
                                  {s.similarity.toFixed(3)}
                                </p>
                              ) : null,
                            )}
                            {el.element_type === 'handwriting_region' ? (
                              <>
                                <p className="rag-debug-meta">
                                  HANDWRITTEN REGION · TYPE: handwriting_region
                                </p>
                                <p className="rag-debug-preview">
                                  OCR TRANSCRIPTION FOR RETRIEVAL:{' '}
                                  {previewText(el.text, 120)}
                                </p>
                                <p className="rag-debug-meta">
                                  NOTE: OCR transcription is derived and may contain
                                  recognition errors. LLM visual context uses the
                                  original stroke image.
                                </p>
                                {(() => {
                                  const att = context.imageAttachments.find(
                                    (a) => a.element_id === el.element_id,
                                  );
                                  return att ? (
                                    <img
                                      className="rag-debug-thumb"
                                      src={att.asset_src}
                                      alt=""
                                      title="LLM visual context"
                                    />
                                  ) : null;
                                })()}
                              </>
                            ) : (
                              <p className="rag-debug-preview">
                                {previewText(el.text, 100)}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <label className="rag-debug-label" htmlFor="rag-debug-serialized">
                      Serialized context payload
                    </label>
                    <textarea
                      id="rag-debug-serialized"
                      className="rag-debug-textarea mono"
                      rows={8}
                      readOnly
                      value={context.serialized}
                    />
                  </section>
                )}

                {llmPromptPreviewOpen && (
                  <section className="rag-debug-section">
                    <div className="rag-debug-section-title">LLM prompt preview</div>
                    <p className="rag-debug-meta">
                      Exact text copied by “Copy LLM prompt” (updates when anchors /
                      expansions / prompt change).
                    </p>
                    <textarea
                      id="rag-debug-llm-prompt"
                      className="rag-debug-textarea mono"
                      rows={14}
                      readOnly
                      value={
                        llmPrompt?.finalLlmPrompt ??
                        '(select anchors to build prompt)'
                      }
                    />
                    <button
                      type="button"
                      className="rag-debug-btn"
                      disabled={!llmPrompt}
                      onClick={() => void copyLlmPrompt()}
                    >
                      Copy all
                    </button>
                  </section>
                )}
              </>
            )}
          </div>

          {error && <p className="rag-debug-error">{error}</p>}
          {statusMessage && !error && <p className="rag-debug-status">{statusMessage}</p>}
        </aside>
      )}

      {responseModalOpen && (
        <div
          className="rag-debug-modal-backdrop"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="rag-debug-modal"
            role="dialog"
            aria-labelledby="rag-paste-title"
            onWheel={(e) => e.stopPropagation()}
          >
            <h2 id="rag-paste-title">Paste LLM response</h2>
            <p className="rag-debug-meta">
              Paste structured JSON operations from ChatGPT. Canvas is unchanged until Apply.
            </p>
            <textarea
              className="rag-debug-textarea mono"
              rows={10}
              value={pastedResponse}
              placeholder='{"operations":[...]}'
              onChange={(e) => setPastedResponse(e.target.value)}
              autoFocus
            />
            <div className="rag-debug-row">
              <button
                type="button"
                className="rag-debug-btn ghost"
                onClick={() => void pasteResponseFromClipboard()}
              >
                Paste from clipboard
              </button>
              <button
                type="button"
                className="rag-debug-btn"
                disabled={!pastedResponse.trim()}
                onClick={() => previewPastedPlan()}
              >
                Preview AI plan
              </button>
            </div>

            {parseError && <p className="rag-debug-error">{parseError}</p>}

            {pendingPlan && pendingPlan.length > 0 && (
              <section className="rag-debug-section">
                <div className="rag-debug-section-title">AI plan</div>
                <pre className="rag-debug-plan">{pendingPlan.join('\n\n')}</pre>
                {layoutDebug && (
                  <>
                    <div className="rag-debug-section-title">Grid placement debug</div>
                    <pre className="rag-debug-plan">
                      {[
                        `Generated objects: ${layoutDebug.objectCount ?? '—'}`,
                        `Requested columns: ${layoutDebug.requestedColumns ?? layoutDebug.columns}`,
                        `Calculated max columns: ${layoutDebug.maxColumns ?? '—'}`,
                        `Final columns: ${layoutDebug.columns}`,
                        `Requested rows: ${layoutDebug.requestedRows ?? '—'}`,
                        `Final rows: ${layoutDebug.rows}`,
                        `Automatic wrapping: ${layoutDebug.wrapped ? 'YES' : 'NO'}`,
                        `Wrapping reason: ${layoutDebug.wrapReason ?? 'none'}`,
                        `Physical width wrapping: ${layoutDebug.widthWrapped ? 'YES' : 'NO'}`,
                        `Column widths: ${layoutDebug.columnWidths.map((w) => w.toFixed(0)).join(', ')}`,
                        `Row heights: ${layoutDebug.rowHeights.map((h) => h.toFixed(0)).join(', ')}`,
                        `Local bounds: ${layoutDebug.localBounds.width.toFixed(0)}×${layoutDebug.localBounds.height.toFixed(0)}`,
                        `Preferred origin: (${layoutDebug.preferredOrigin.x.toFixed(0)}, ${layoutDebug.preferredOrigin.y.toFixed(0)})`,
                        `Final origin: ${
                          layoutDebug.finalOrigin
                            ? `(${layoutDebug.finalOrigin.x.toFixed(0)}, ${layoutDebug.finalOrigin.y.toFixed(0)})`
                            : '(none)'
                        }`,
                        `Candidates tested: ${layoutDebug.candidatesTested}`,
                        `Collided at preferred: ${layoutDebug.collidedAtPreferred}`,
                        `Collision validation: ${layoutDebug.collisionFree ? 'PASSED' : 'FAILED'}`,
                        `Obstacles: ${layoutDebug.obstacleCount}`,
                        ...(layoutDebug.chronologicalCells
                          ? [
                              `Generated cells: ${layoutDebug.chronologicalCells.cellCount}`,
                              `Chronological ordering: ${layoutDebug.chronologicalCells.chronologicalOrderingValid ? 'VALID' : 'INVALID'}`,
                              `Maximum objects per cell: ${layoutDebug.chronologicalCells.maxObjectsPerCell}`,
                              `Object creation order: ${layoutDebug.chronologicalCells.objectOrder.join(' → ')}`,
                              ...(layoutDebug.chronologicalCells.splits.length
                                ? [
                                    'Automatic cell splitting:',
                                    ...layoutDebug.chronologicalCells.splits.map(
                                      (s) =>
                                        `  ${s.originalCellId}: [${s.memberRefs.join(', ')}] → ${s.partCellIds.map((id, i) => `${id}(${s.partSizes[i]})`).join(' + ')}`,
                                    ),
                                  ]
                                : ['Automatic cell splitting: none']),
                              'Cell sequence:',
                              ...layoutDebug.chronologicalCells.cells.map(
                                (c, idx) =>
                                  [
                                    `  Cell ${idx + 1} (${c.cellId})${c.autoSplit ? ' [auto-split]' : ''}: r${c.row}c${c.column} span${c.columnSpan} ${c.width.toFixed(0)}×${c.height.toFixed(0)}`,
                                    ...c.refs.map((r) => `    - ${r}`),
                                  ].join('\n'),
                              ),
                            ]
                          : []),
                        ...layoutDebug.items.map((it) => {
                          const base = `  ${it.ref}: r${it.row}c${it.column} span${it.columnSpan} → ${it.width.toFixed(0)}×${it.height.toFixed(0)} @ (${it.localX.toFixed(0)}, ${it.localY.toFixed(0)})`;
                          const tas = it.textAutoSize;
                          if (!tas) return base;
                          return [
                            base,
                            `    autoSize: content ${tas.contentWidth.toFixed(0)}×${tas.contentHeight.toFixed(0)} → box ${tas.finalWidth.toFixed(0)}×${tas.finalHeight.toFixed(0)} pad=${tas.padding}`,
                            `    lines=${tas.wrappedLines ?? '—'} dom=${tas.measuredWithDom} rowExpanded=${tas.rowExpanded} reflow=${tas.reflowChanged}`,
                          ].join('\n');
                        }),
                        ...(layoutDebug.diagnostics.length
                          ? ['Diagnostics:', ...layoutDebug.diagnostics.map((d) => `  ${d}`)]
                          : []),
                        ...(layoutDebug.error ? [`Error: ${layoutDebug.error}`] : []),
                      ].join('\n')}
                    </pre>
                  </>
                )}
                {pendingOperations && (
                  <>
                    <div className="rag-debug-section-title">Raw JSON</div>
                    <pre className="rag-debug-plan">
                      {JSON.stringify(pendingOperations, null, 2)}
                    </pre>
                  </>
                )}
              </section>
            )}

            <div className="rag-debug-row">
              <button type="button" className="rag-debug-btn" onClick={closeResponseModal}>
                Cancel
              </button>
              <button
                type="button"
                className="rag-debug-btn primary"
                disabled={!pastedResponse.trim()}
                onClick={() => applyPastedResponse()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
