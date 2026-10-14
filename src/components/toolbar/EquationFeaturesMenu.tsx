import { useEffect, useRef, useState } from 'react';
import type { EquationElement } from '../../types/canvas';
import {
  uiAddEquationInterpretation,
  uiAddEquationSymbolDefinitions,
  uiAddTextToEquation,
  uiSetEquationTitle,
  uiUpdateEquation,
} from '../../features/equations/equationComponentUi';
import type { EquationComponentKind } from '../../features/text/textComponents';

type Props = {
  element: EquationElement;
};

export function EquationFeaturesMenu({ element }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = () => setOpen(false);

  const addKind = (kind: EquationComponentKind, promptLabel: string) => {
    const text = window.prompt(promptLabel);
    if (!text?.trim()) return;
    uiAddTextToEquation(element.id, kind, text);
    close();
  };

  return (
    <div className="ctx-features" ref={rootRef}>
      <button
        type="button"
        className={open ? 'ctx-chip active' : 'ctx-chip'}
        title="Equation features"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Features ▾
      </button>
      {open && (
        <div className="ctx-features-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const latex = window.prompt('Edit LaTeX', element.latex);
              if (latex == null) return;
              if (!latex.trim()) return;
              uiUpdateEquation(element.id, latex);
              close();
            }}
          >
            Edit LaTeX
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Equation title');
              if (!text?.trim()) return;
              uiSetEquationTitle(element.id, text);
              close();
            }}
          >
            Add Title
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => addKind('lead_in', 'Lead-in explanation')}
          >
            Add Lead-in
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() =>
              addKind('step_explanation', 'Step explanation')
            }
          >
            Add Explanation
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const raw = window.prompt(
                'Symbol definitions (one per line: symbol — definition)',
                'm — Mass of the object\nk — Spring constant',
              );
              if (!raw?.trim()) return;
              const symbols = raw
                .split('\n')
                .map((line) => {
                  const parts = line.split(/—|-/).map((s) => s.trim());
                  if (parts.length < 2) return null;
                  return {
                    symbol: parts[0]!,
                    definition: parts.slice(1).join(' — '),
                  };
                })
                .filter((s): s is { symbol: string; definition: string } => !!s);
              if (symbols.length === 0) return;
              uiAddEquationSymbolDefinitions(element.id, symbols);
              close();
            }}
          >
            Define Symbols
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Interpretation / key result');
              if (!text?.trim()) return;
              uiAddEquationInterpretation(element.id, text);
              close();
            }}
          >
            Add Interpretation
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => addKind('warning', 'Warning / assumptions')}
          >
            Add Warning
          </button>
        </div>
      )}
    </div>
  );
}
