/**
 * LaTeX editing overlay for EquationElements (mirrors TextEditorOverlay).
 */

import { useEffect, useRef, useState } from 'react';
import type { Camera, EquationElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import {
  renderLatexHtml,
  sanitizeLatexSource,
  validateLatex,
} from '../features/equations/latex';

interface Props {
  element: EquationElement;
  camera: Camera;
  onCommit: (latex: string) => void;
  onCancel: () => void;
}

export function EquationEditorOverlay({
  element,
  camera,
  onCommit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(element.latex);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const topLeft = worldToScreen({ x: element.x, y: element.y }, camera);
  const width = Math.max(element.width * camera.zoom, 220);
  const cleaned = sanitizeLatexSource(value);
  const validation = validateLatex(cleaned, element.displayMode !== 'inline');
  const preview = validation.ok
    ? renderLatexHtml(cleaned, { displayMode: element.displayMode !== 'inline' })
    : { html: '', error: validation.error };

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  return (
    <div
      className="equation-editor-overlay"
      style={{
        transform: `translate(${topLeft.x}px, ${topLeft.y}px)`,
        width,
        minHeight: Math.max(element.height * camera.zoom, 120),
      }}
    >
      <label className="equation-editor-label">LaTeX</label>
      <textarea
        ref={textareaRef}
        className="equation-editor-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (validation.ok) onCommit(cleaned);
          }
        }}
        spellCheck={false}
      />
      <div className="equation-editor-preview">
        <span className="equation-editor-label">Preview</span>
        {preview.error ? (
          <div className="equation-html-error">{preview.error}</div>
        ) : (
          <div
            className="equation-html-math"
            style={{ fontSize: element.fontSize * camera.zoom, color: element.color }}
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        )}
      </div>
      <div className="equation-editor-actions">
        <button type="button" className="equation-editor-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="equation-editor-btn equation-editor-btn--primary"
          disabled={!validation.ok}
          onClick={() => onCommit(cleaned)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
