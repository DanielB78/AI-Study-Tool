import { useCallback, useEffect, useRef } from 'react';
import { useAiStore } from '../state/aiStore';
import { AiPromptBar } from './AiPromptBar';

/** Delay before collapsing after blur / outside click so related UI stays usable. */
const COLLAPSE_DELAY_MS = 220;

/**
 * Floating AI chrome — bottom-centre over the canvas.
 * Successful replies become TextElements on the board (not a floating panel).
 */
export function AiFloatingPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);

  const expanded = useAiStore((s) => s.expanded);
  const status = useAiStore((s) => s.status);
  const prompt = useAiStore((s) => s.prompt);
  const errorMessage = useAiStore((s) => s.errorMessage);
  const statusMessage = useAiStore((s) => s.statusMessage);
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
      if (state.errorMessage) return;
      if (state.statusMessage) return;
      if (state.prompt.trim()) return;
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) return;
      collapse();
    }, COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, collapse]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  useEffect(() => {
    if (!expanded) return;

    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) {
        keepOpen();
        return;
      }
      const state = useAiStore.getState();
      if (state.status === 'loading') return;
      if (state.errorMessage || state.statusMessage) return;
      if (state.prompt.trim()) return;
      scheduleCollapse();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded, keepOpen, scheduleCollapse]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const state = useAiStore.getState();
      if (!state.expanded) return;
      if (state.status === 'loading') return;
      e.preventDefault();
      e.stopPropagation();
      state.collapse();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const onBlurCapture = () => {
    window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) {
        keepOpen();
        return;
      }
      if (
        status === 'loading' ||
        errorMessage ||
        statusMessage ||
        prompt.trim()
      ) {
        keepOpen();
        return;
      }
      scheduleCollapse();
    });
  };

  return (
    <div
      ref={rootRef}
      className={`ai-floating${expanded ? ' is-open' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onBlurCapture={onBlurCapture}
      onFocusCapture={keepOpen}
    >
      <AiPromptBar onInteraction={keepOpen} />
    </div>
  );
}
