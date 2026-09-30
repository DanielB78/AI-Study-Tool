import { useMemo, useState } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import { buildLlmPrompt } from '../../ai/llm';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MAX,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MIN,
  RAG_SPATIAL_RADIUS_MAX,
  RAG_SPATIAL_RADIUS_MIN,
  RAG_SPATIAL_RADIUS_STEP,
} from '../config';
import { computeDebugContext, useRagDebugStore } from '../ragDebugStore';
import type { SemanticTreeNode } from '../semanticExpansion';

type RagDebugPage =
  | 'intent'
  | 'matches'
  | 'spatial'
  | 'semantic'
  | 'context';

const RAG_DEBUG_PAGES: { id: RagDebugPage; label: string }[] = [
  { id: 'intent', label: 'Intent' },
  { id: 'matches', label: 'Matches' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'semantic', label: 'Semantic' },
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
  const [page, setPage] = useState<RagDebugPage>('matches');
  const open = useRagDebugStore((s) => s.open);
  const prompt = useRagDebugStore((s) => s.prompt);
  const retrieving = useRagDebugStore((s) => s.retrieving);
  const expanding = useRagDebugStore((s) => s.expanding);
  const sending = useRagDebugStore((s) => s.sending);
  const error = useRagDebugStore((s) => s.error);
  const statusMessage = useRagDebugStore((s) => s.statusMessage);
  const candidates = useRagDebugStore((s) => s.candidates);
  const selectedAnchorIds = useRagDebugStore((s) => s.selectedAnchorIds);
  const spatialExpansionEnabled = useRagDebugStore((s) => s.spatialExpansionEnabled);
  const radius = useRagDebugStore((s) => s.radius);
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
  const parseError = useRagDebugStore((s) => s.parseError);
  const llmExecutionMode = useRagDebugStore((s) => s.llmExecutionMode);
  const lastQueryChunks = useRagDebugStore((s) => s.lastQueryChunks);
  const lastRetrieveMeta = useRagDebugStore((s) => s.lastRetrieveMeta);
  const promptIntent = useRagDebugStore((s) => s.promptIntent);
  const elements = useCanvasStore((s) => s.document.elements);

  const setPrompt = useRagDebugStore((s) => s.setPrompt);
  const setRadius = useRagDebugStore((s) => s.setRadius);
  const setSpatialExpansionEnabled = useRagDebugStore((s) => s.setSpatialExpansionEnabled);
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

  const { context, semanticTrees } = useMemo(
    () =>
      computeDebugContext(
        {
          prompt,
          candidates,
          selectedAnchorIds,
          spatialExpansionEnabled,
          radius,
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
      spatialExpansionEnabled,
      radius,
      semanticExpansionEnabled,
      semanticExpansionDepth,
      semanticMaxNeighbours,
      semanticExpandResponse,
      semanticIncludedIds,
      elements,
    ],
  );

  const llmPrompt = useMemo(() => {
    if (!prompt.trim() || selectedAnchorIds.length === 0) return null;
    return buildLlmPrompt({ userPrompt: prompt, ragContext: context });
  }, [prompt, context, selectedAnchorIds.length]);

  const selectedSet = useMemo(() => new Set(selectedAnchorIds), [selectedAnchorIds]);
  const includedSet = useMemo(() => new Set(semanticIncludedIds), [semanticIncludedIds]);
  const collapsedSet = useMemo(
    () => new Set(semanticCollapsedKeys),
    [semanticCollapsedKeys],
  );
  const busy = retrieving || sending || expanding;
  const manual = llmExecutionMode === 'manual';
  const canBuildPrompt = selectedAnchorIds.length > 0 && prompt.trim().length > 0;
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
            anchors {context.stats.semantic_anchor_count}
            {' · '}
            spatial {context.stats.spatial_addition_count}
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
                            <span className="rag-debug-id">{c.element_id}</span>
                          </label>
                          <p className="rag-debug-preview">{previewText(preview)}</p>
                          <p className="rag-debug-meta">
                            {c.matched_chunks.length} matched chunk(s)
                            {c.matched_chunks[0] != null
                              ? ` · best chunk #${c.matched_chunks[0].chunk_index}`
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
                  Independent of semantic knowledge expansion.
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
                  {' · '}
                  anchors selected: <strong>{selectedAnchorIds.length}</strong>
                </p>
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

            {page === 'context' && (
              <>
                <section className="rag-debug-section rag-debug-counts">
                  <div className="rag-debug-section-title">Final context</div>
                  <div>
                    Semantic anchors:{' '}
                    <strong>{context.stats.semantic_anchor_count}</strong>
                  </div>
                  <div>
                    Spatial additions:{' '}
                    <strong>{context.stats.spatial_addition_count}</strong>
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
                    {RAG_MAX_CONTEXT_CHARACTERS} chars
                    {(context.stats.truncated_by_element_budget ||
                      context.stats.truncated_by_character_budget) &&
                      ' · truncated'}
                  </div>
                </section>

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
                    <ul className="rag-debug-list compact">
                      {context.allElements.map((el) => {
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
                            <p className="rag-debug-preview">
                              {previewText(el.text, 100)}
                            </p>
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
