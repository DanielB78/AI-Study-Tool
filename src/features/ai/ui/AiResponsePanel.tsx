import { useState } from 'react';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { useAiStore } from '../state/aiStore';

interface AiResponsePanelProps {
  onInteraction: () => void;
}

export function AiResponsePanel({ onInteraction }: AiResponsePanelProps) {
  const responseVisible = useAiStore((s) => s.responseVisible);
  const responseText = useAiStore((s) => s.responseText);
  const errorMessage = useAiStore((s) => s.errorMessage);
  const status = useAiStore((s) => s.status);
  const closeResponse = useAiStore((s) => s.closeResponse);
  const copyResponse = useAiStore((s) => s.copyResponse);
  const regenerate = useAiStore((s) => s.regenerate);
  const [copied, setCopied] = useState(false);

  if (!responseVisible) return null;

  const showError = status === 'error' && errorMessage;
  const showLoading = status === 'loading' && !responseText && !showError;
  const body = showError ? errorMessage : responseText;

  return (
    <div
      className={`ai-response-panel${showError ? ' is-error' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onInteraction();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      role="region"
      aria-label="AI response"
    >
      <div className="ai-response-header">
        <span className="ai-response-label">{showError ? 'Error' : 'AI'}</span>
        <div className="ai-response-actions">
          {!showError && responseText && (
            <>
              <button
                type="button"
                className="ai-icon-btn"
                aria-label="Copy response"
                title="Copy"
                onClick={async () => {
                  onInteraction();
                  const ok = await copyResponse();
                  if (ok) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  }
                }}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
              <button
                type="button"
                className="ai-icon-btn"
                aria-label="Regenerate"
                title="Regenerate"
                disabled={status === 'loading'}
                onClick={() => {
                  onInteraction();
                  void regenerate();
                }}
              >
                <RefreshCw size={14} aria-hidden />
              </button>
            </>
          )}
          <button
            type="button"
            className="ai-icon-btn"
            aria-label="Close response"
            title="Close"
            disabled={status === 'loading'}
            onClick={() => {
              onInteraction();
              closeResponse();
            }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>

      <div className="ai-response-body">
        {showLoading ? (
          <p className="ai-response-loading">Thinking…</p>
        ) : (
          <pre className="ai-response-text" tabIndex={0}>
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}
