import { useMemo } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import { buildLlmPrompt } from '../../ai/llm';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_SPATIAL_RADIUS_MAX,
  RAG_SPATIAL_RADIUS_MIN,
  RAG_SPATIAL_RADIUS_STEP,
} from '../config';
import {
  computeDebugContext,
  getInteractionContextFromState,
  useRagDebugStore,
} from '../ragDebugStore';

function previewText(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Development-only RAG debug panel: retrieve → anchors → radius →
 * copy LLM prompt / paste response (Manual LLM Mode by default).
 */
export function RagDebugPanel() {
  const open = useRagDebugStore((s) => s.open);
  const prompt = useRagDebugStore((s) => s.prompt);
  const retrieving = useRagDebugStore((s) => s.retrieving);
  const retrievingInteractions = useRagDebugStore((s) => s.retrievingInteractions);
  const sending = useRagDebugStore((s) => s.sending);
  const error = useRagDebugStore((s) => s.error);
  const statusMessage = useRagDebugStore((s) => s.statusMessage);
  const candidates = useRagDebugStore((s) => s.candidates);
  const selectedAnchorIds = useRagDebugStore((s) => s.selectedAnchorIds);
  const recentInteractions = useRagDebugStore((s) => s.recentInteractions);
  const historicalCandidates = useRagDebugStore((s) => s.historicalCandidates);
  const selectedHistoricalIds = useRagDebugStore((s) => s.selectedHistoricalIds);
  const radius = useRagDebugStore((s) => s.radius);
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
  const lastInteractionRetrieveMeta = useRagDebugStore(
    (s) => s.lastInteractionRetrieveMeta,
  );
  const elements = useCanvasStore((s) => s.document.elements);

  const setPrompt = useRagDebugStore((s) => s.setPrompt);
  const setRadius = useRagDebugStore((s) => s.setRadius);
  const toggleAnchor = useRagDebugStore((s) => s.toggleAnchor);
  const selectTopN = useRagDebugStore((s) => s.selectTopN);
  const clearAnchors = useRagDebugStore((s) => s.clearAnchors);
  const toggleHistorical = useRagDebugStore((s) => s.toggleHistorical);
  const selectTopHistorical = useRagDebugStore((s) => s.selectTopHistorical);
  const clearHistorical = useRagDebugStore((s) => s.clearHistorical);
  const retrieve = useRagDebugStore((s) => s.retrieve);
  const retrieveInteractions = useRagDebugStore((s) => s.retrieveInteractions);
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

  const { context } = useMemo(
    () =>
      computeDebugContext(
        {
          prompt,
          candidates,
          selectedAnchorIds,
          radius,
        },
        elements,
      ),
    [prompt, candidates, selectedAnchorIds, radius, elements],
  );

  const { recentInteractions: recentCtx, historicalInteractions } = useMemo(
    () =>
      getInteractionContextFromState({
        recentInteractions,
        historicalCandidates,
        selectedHistoricalIds,
      }),
    [recentInteractions, historicalCandidates, selectedHistoricalIds],
  );

  const existingElementIds = useMemo(
    () => elements.map((e) => e.id),
    [elements],
  );

  const llmPrompt = useMemo(() => {
    if (!prompt.trim() || selectedAnchorIds.length === 0) return null;
    return buildLlmPrompt({
      userPrompt: prompt,
      ragContext: context,
      recentInteractions: recentCtx,
      historicalInteractions,
      existingElementIds,
    });
  }, [
    prompt,
    context,
    selectedAnchorIds.length,
    recentCtx,
    historicalInteractions,
    existingElementIds,
  ]);

  const selectedSet = useMemo(() => new Set(selectedAnchorIds), [selectedAnchorIds]);
  const selectedHistoricalSet = useMemo(
    () => new Set(selectedHistoricalIds),
    [selectedHistoricalIds],
  );
  const busy = retrieving || retrievingInteractions || sending;
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
            rows={3}
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
              {retrieving || retrievingInteractions ? 'Retrieving…' : 'Retrieve'}
            </button>
            {lastRetrieveMeta && (
              <span className="rag-debug-meta">
                {lastQueryChunks} query chunk(s) · {lastRetrieveMeta.embedding_model}
              </span>
            )}
          </div>

          <section className="rag-debug-section rag-debug-interactions">
            <div className="rag-debug-section-title">Interaction memory</div>
            <div className="rag-debug-row">
              <button
                type="button"
                className="rag-debug-btn"
                disabled={!prompt.trim() || retrievingInteractions}
                onClick={() => void retrieveInteractions()}
              >
                {retrievingInteractions ? 'Retrieving…' : 'Retrieve interactions'}
              </button>
              {lastInteractionRetrieveMeta && (
                <span className="rag-debug-meta">
                  recent {lastInteractionRetrieveMeta.recent_count} · top_k{' '}
                  {lastInteractionRetrieveMeta.top_k}
                </span>
              )}
            </div>

            <div className="rag-debug-section-title">Automatic recent context</div>
            {recentInteractions.length === 0 ? (
              <p className="rag-debug-empty">No recent interactions yet.</p>
            ) : (
              <ul className="rag-debug-list compact">
                {recentInteractions.map((i) => (
                  <li key={i.id} className="rag-debug-item">
                    <div className="rag-debug-row tight">
                      <span className="rag-debug-id">{i.id}</span>
                      <span className={`rag-debug-badge status-${i.status}`}>{i.status}</span>
                    </div>
                    <p className="rag-debug-preview">{previewText(i.user_prompt)}</p>
                    <p className="rag-debug-meta">{previewText(i.action_summary, 100)}</p>
                    <p className="rag-debug-meta">
                      tx {i.transaction_id}
                      {i.affected_element_ids.length
                        ? ` · affected ${i.affected_element_ids.join(', ')}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="rag-debug-section-title">Relevant older interactions</div>
            <div className="rag-debug-shortcuts">
              <button
                type="button"
                className="rag-debug-btn ghost"
                disabled={!historicalCandidates.length}
                onClick={() => selectTopHistorical(1)}
              >
                Top 1
              </button>
              <button
                type="button"
                className="rag-debug-btn ghost"
                disabled={!historicalCandidates.length}
                onClick={() => selectTopHistorical(3)}
              >
                Top 3
              </button>
              <button
                type="button"
                className="rag-debug-btn ghost"
                disabled={!historicalCandidates.length}
                onClick={() => selectTopHistorical(5)}
              >
                Top 5
              </button>
              <button
                type="button"
                className="rag-debug-btn ghost"
                disabled={!selectedHistoricalIds.length}
                onClick={clearHistorical}
              >
                Clear
              </button>
            </div>
            {historicalCandidates.length === 0 ? (
              <p className="rag-debug-empty">No historical matches yet.</p>
            ) : (
              <ul className="rag-debug-list">
                {historicalCandidates.map((i) => {
                  const checked = selectedHistoricalSet.has(i.id);
                  return (
                    <li
                      key={i.id}
                      className={`rag-debug-item${checked ? ' is-selected' : ''}`}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleHistorical(i.id)}
                        />
                        <span className="rag-debug-score">
                          {i.similarity != null ? i.similarity.toFixed(3) : '—'}
                        </span>
                        <span className="rag-debug-id">{i.id}</span>
                      </label>
                      <p className="rag-debug-preview">{previewText(i.user_prompt)}</p>
                      <p className="rag-debug-meta">{previewText(i.action_summary, 100)}</p>
                      <p className="rag-debug-meta">
                        tx {i.transaction_id} · {i.status}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rag-debug-section">
            <div className="rag-debug-section-title">Semantic matches</div>
            <div className="rag-debug-shortcuts">
              <button type="button" className="rag-debug-btn ghost" disabled={!candidates.length} onClick={() => selectTopN(1)}>
                Top 1
              </button>
              <button type="button" className="rag-debug-btn ghost" disabled={!candidates.length} onClick={() => selectTopN(3)}>
                Top 3
              </button>
              <button type="button" className="rag-debug-btn ghost" disabled={!candidates.length} onClick={() => selectTopN(5)}>
                Top 5
              </button>
              <button type="button" className="rag-debug-btn ghost" disabled={!selectedAnchorIds.length} onClick={clearAnchors}>
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
                    <li key={c.element_id} className={`rag-debug-item${checked ? ' is-selected' : ''}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAnchor(c.element_id)}
                        />
                        <span className="rag-debug-score">{c.score.toFixed(3)}</span>
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

          <section className="rag-debug-section">
            <div className="rag-debug-section-title">
              Spatial radius{' '}
              <span className="rag-debug-radius-value">{radius} world units</span>
            </div>
            <input
              type="range"
              className="rag-debug-slider"
              min={RAG_SPATIAL_RADIUS_MIN}
              max={RAG_SPATIAL_RADIUS_MAX}
              step={RAG_SPATIAL_RADIUS_STEP}
              value={radius}
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
                onChange={(e) => setRadius(Number(e.target.value) || 0)}
              />
              <span className="rag-debug-meta">0 = semantic anchors only</span>
            </div>
          </section>

          <section className="rag-debug-section rag-debug-counts">
            <div>
              Recent interactions: <strong>{recentInteractions.length}</strong>
            </div>
            <div>
              Historical matches: <strong>{historicalCandidates.length}</strong>
              {selectedHistoricalIds.length > 0 && (
                <> (selected {selectedHistoricalIds.length})</>
              )}
            </div>
            <div>
              Semantic anchors: <strong>{context.stats.semantic_anchor_count}</strong>
            </div>
            <div>
              Spatial additions: <strong>{context.stats.spatial_addition_count}</strong>
            </div>
            <div>
              Total unique: <strong>{context.stats.total_unique_elements}</strong>
            </div>
            <div>
              ~{context.stats.word_count} words · {context.stats.character_count} chars
            </div>
            <div className="rag-debug-meta">
              Budget: {RAG_MAX_CONTEXT_ELEMENTS} elements / {RAG_MAX_CONTEXT_CHARACTERS} chars
              {(context.stats.truncated_by_element_budget ||
                context.stats.truncated_by_character_budget) &&
                ' · truncated'}
            </div>
          </section>

          <div className="rag-debug-row">
            <button
              type="button"
              className="rag-debug-btn"
              disabled={
                context.stats.total_unique_elements === 0 &&
                recentInteractions.length === 0 &&
                historicalInteractions.length === 0
              }
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
              disabled={!canBuildPrompt && !prompt.trim()}
              onClick={() => void copyLlmPrompt()}
              title="Undo/redo intents apply immediately without anchors"
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
                disabled={!canSendAutomatic && !prompt.trim()}
                onClick={() => void sendWithContext()}
                title="Calls the backend LLM API (uses credits). Undo intents skip the API."
              >
                {sending ? 'Sending…' : 'Send with context (API)'}
              </button>
            )}
          </div>

          {previewOpen && (
            <section className="rag-debug-section">
              <div className="rag-debug-section-title">Context preview</div>

              <div className="rag-debug-section-title">Recent interactions</div>
              {recentCtx.length === 0 ? (
                <p className="rag-debug-empty">(none)</p>
              ) : (
                <ul className="rag-debug-list compact">
                  {recentCtx.map((i) => (
                    <li key={i.id} className="rag-debug-item">
                      <span className="rag-debug-id">{i.id}</span>
                      <p className="rag-debug-preview">{previewText(i.action_summary, 100)}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rag-debug-section-title">Historical interactions</div>
              {historicalInteractions.length === 0 ? (
                <p className="rag-debug-empty">(none selected)</p>
              ) : (
                <ul className="rag-debug-list compact">
                  {historicalInteractions.map((i) => (
                    <li key={i.id} className="rag-debug-item">
                      <div className="rag-debug-row tight">
                        <span className="rag-debug-id">{i.id}</span>
                        {i.similarity != null && (
                          <span className="rag-debug-score">{i.similarity.toFixed(3)}</span>
                        )}
                      </div>
                      <p className="rag-debug-preview">{previewText(i.action_summary, 100)}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rag-debug-section-title">Canvas elements</div>
              <ul className="rag-debug-list compact">
                {context.allElements.map((el) => (
                  <li key={el.element_id} className="rag-debug-item">
                    <div className="rag-debug-row tight">
                      <span className={`rag-debug-badge ${el.inclusion}`}>{el.inclusion}</span>
                      <span className="rag-debug-id">{el.element_id}</span>
                      {el.similarity != null && (
                        <span className="rag-debug-score">{el.similarity.toFixed(3)}</span>
                      )}
                      {el.nearest_distance != null && (
                        <span className="rag-debug-meta">d={el.nearest_distance.toFixed(1)}</span>
                      )}
                    </div>
                    <p className="rag-debug-preview">{previewText(el.text, 100)}</p>
                  </li>
                ))}
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
                Exact text copied by “Copy LLM prompt” (regenerates when anchors/radius/prompt/interactions change).
              </p>
              <textarea
                id="rag-debug-llm-prompt"
                className="rag-debug-textarea mono"
                rows={14}
                readOnly
                value={llmPrompt?.finalLlmPrompt ?? '(select anchors to build prompt)'}
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
                <pre
                  className={
                    pendingPlan.some((line) => line.includes('DELETE'))
                      ? 'rag-debug-plan rag-debug-plan-destructive'
                      : 'rag-debug-plan'
                  }
                >
                  {pendingPlan.join('\n\n')}
                </pre>
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
