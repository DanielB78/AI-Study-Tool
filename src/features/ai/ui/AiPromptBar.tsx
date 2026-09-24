import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { useAiStore } from '../state/aiStore';

const MAX_TEXTAREA_HEIGHT = 140;

interface AiPromptBarProps {
  onInteraction: () => void;
}

export function AiPromptBar({ onInteraction }: AiPromptBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expanded = useAiStore((s) => s.expanded);
  const prompt = useAiStore((s) => s.prompt);
  const status = useAiStore((s) => s.status);
  const errorMessage = useAiStore((s) => s.errorMessage);
  const statusMessage = useAiStore((s) => s.statusMessage);
  const expand = useAiStore((s) => s.expand);
  const setPrompt = useAiStore((s) => s.setPrompt);
  const sendPrompt = useAiStore((s) => s.sendPrompt);
  const collapse = useAiStore((s) => s.collapse);
  const clearError = useAiStore((s) => s.clearError);

  const loading = status === 'loading';
  const canSend = prompt.trim().length > 0 && !loading;

  useEffect(() => {
    if (!expanded) return;
    const el = textareaRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => el.focus());
    return () => window.cancelAnimationFrame(id);
  }, [expanded]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !expanded) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [prompt, expanded]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      if (!loading) {
        textareaRef.current?.blur();
        collapse();
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) void sendPrompt();
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="ai-ask-pill"
        onClick={() => {
          onInteraction();
          expand();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Ask AI"
      >
        <Sparkles size={15} strokeWidth={2.2} aria-hidden />
        <span>Ask AI</span>
      </button>
    );
  }

  return (
    <div
      className="ai-prompt-stack"
      onPointerDown={(e) => {
        e.stopPropagation();
        onInteraction();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {(errorMessage || statusMessage) && (
        <div
          className={`ai-status-chip${errorMessage ? ' is-error' : ' is-success'}`}
          role="status"
        >
          <span>{errorMessage ?? statusMessage}</span>
          {errorMessage && (
            <button
              type="button"
              className="ai-status-dismiss"
              aria-label="Dismiss error"
              onClick={() => {
                onInteraction();
                clearError();
              }}
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="ai-prompt-bar">
        <textarea
          ref={textareaRef}
          className="ai-prompt-input"
          value={prompt}
          placeholder="Ask anything…"
          rows={1}
          disabled={loading}
          onChange={(e) => {
            onInteraction();
            setPrompt(e.target.value);
          }}
          onFocus={onInteraction}
          onKeyDown={onKeyDown}
          aria-label="AI prompt"
        />
        <button
          type="button"
          className="ai-send-btn"
          disabled={!canSend}
          onClick={() => {
            onInteraction();
            void sendPrompt();
          }}
          aria-label={loading ? 'Sending' : 'Send prompt'}
        >
          {loading ? (
            <Loader2 size={16} className="ai-spin" aria-hidden />
          ) : (
            <ArrowUp size={16} strokeWidth={2.4} aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
