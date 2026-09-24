import { useCallback, useEffect, useRef } from 'react';
import { useAiStore } from '../state/aiStore';
import { AiPromptBar } from './AiPromptBar';
import { AiResponsePanel } from './AiResponsePanel';

/** Delay before collapsing after blur / outside click so related UI stays usable. */
const COLLAPSE_DELAY_MS = 220;

/**
 * Floating AI chrome — bottom-centre over the canvas.
 * Does not alter world coordinates, camera, or CanvasDocument.
 */
export function AiFloatingPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);

  const expanded = useAiStore((s) => s.expanded);
  const status = useAiStore((s) => s.status);
  const responseVisible = useAiStore((s) => s.responseVisible);
  const prompt = useAiStore((s) => s.prompt);
  const collapse = useAiStore((s) => s.collapse);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const keepOpen = useCallback(() => {
    clearCollapseTimer();
  }, [clearCollapseTimer]);

  const scheduleCollapse = useCallback(() => {
    clearCollapseTimer();
    collapseTimer.current = window.setTimeout(() => {
      const state = useAiStore.getState();
      if (state.status === 'loading') return;
      if (state.responseVisible) return;
      if (state.prompt.trim()) return;
      // If focus moved into the panel, keep open.
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) return;
      collapse();
    }, COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, collapse]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  // Outside pointer → collapse when empty and not loading/showing a response.
  useEffect(() => {
    if (!expanded && !responseVisible) return;

    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) {
        keepOpen();
        return;
      }
      const state = useAiStore.getState();
      if (state.status === 'loading') return;
      if (state.responseVisible) return;
      if (state.prompt.trim()) {
        // Keep expanded while drafting, but blur will schedule collapse only when empty.
        return;
      }
      scheduleCollapse();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded, responseVisible, keepOpen, scheduleCollapse]);

  // Escape collapses when appropriate (also handled inside the textarea).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const state = useAiStore.getState();
      if (!state.expanded && !state.responseVisible) return;
      if (state.status === 'loading') return;

      // Prefer closing the response first, then the prompt.
      if (state.responseVisible) {
        e.preventDefault();
        e.stopPropagation();
        state.closeResponse();
        return;
      }
      if (state.expanded) {
        e.preventDefault();
        e.stopPropagation();
        state.collapse();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const onBlurCapture = () => {
    // After focus leaves a child, decide whether to collapse.
    window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) {
        keepOpen();
        return;
      }
      if (status === 'loading' || responseVisible || prompt.trim()) {
        keepOpen();
        return;
      }
      scheduleCollapse();
    });
  };

  return (
    <div
      ref={rootRef}
      className={`ai-floating${expanded || responseVisible ? ' is-open' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onBlurCapture={onBlurCapture}
      onFocusCapture={keepOpen}
    >
      <AiResponsePanel onInteraction={keepOpen} />
      <AiPromptBar onInteraction={keepOpen} />
    </div>
  );
}
