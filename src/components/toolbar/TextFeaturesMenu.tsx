import { useEffect, useRef, useState } from 'react';
import type { TextElement } from '../../types/canvas';
import {
  getSelectedTextQuote,
  uiHighlightSelectedQuote,
  uiInsertHeading,
} from '../../features/text/textFeatureUi';
import {
  uiAddLinkedComment,
  uiCreateDefinition,
  uiCreateExample,
  uiCreateExercise,
  uiCreateTextComponent,
  uiCreateWarning,
  uiSetAssociatedTitle,
} from '../../features/text/textComponentUi';
import { getComponentType } from '../../features/text/textComponents';

type Props = {
  element: TextElement;
};

export function TextFeaturesMenu({ element }: Props) {
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
  const associateId =
    getComponentType(element) === 'main_text' ? element.id : element.id;

  return (
    <div className="ctx-features" ref={rootRef}>
      <button
        type="button"
        className={open ? 'ctx-chip active' : 'ctx-chip'}
        title="Add text component"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Add ▾
      </button>
      {open && (
        <div className="ctx-features-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Main text');
              if (!text?.trim()) return;
              uiCreateTextComponent('main_text', text);
              close();
            }}
          >
            Main text
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Title');
              if (!text?.trim()) return;
              uiSetAssociatedTitle(text, associateId);
              close();
            }}
          >
            Title
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Heading text');
              if (!text?.trim()) return;
              uiInsertHeading(text, 1, element.id);
              close();
            }}
          >
            Insert heading
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Subheading text');
              if (!text?.trim()) return;
              uiInsertHeading(text, 2, element.id);
              close();
            }}
          >
            Insert subheading
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Definition');
              if (!text?.trim()) return;
              uiCreateDefinition(text, associateId);
              close();
            }}
          >
            Definition
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Example');
              if (!text?.trim()) return;
              uiCreateExample(text, associateId);
              close();
            }}
          >
            Example
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Warning / common mistake');
              if (!text?.trim()) return;
              uiCreateWarning(text, associateId, 'common_mistake');
              close();
            }}
          >
            Warning
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Exercise / question');
              if (!text?.trim()) return;
              uiCreateExercise(text, associateId);
              close();
            }}
          >
            Exercise
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const q =
                getSelectedTextQuote() ||
                window.prompt('Phrase to attach the comment to');
              if (!q?.trim()) return;
              const comment = window.prompt('Comment text');
              if (!comment?.trim()) return;
              uiAddLinkedComment({ quote: q.trim() }, comment, element.id);
              close();
            }}
          >
            Linked comment
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const q =
                getSelectedTextQuote() ||
                window.prompt('Phrase to highlight');
              if (!q?.trim()) return;
              uiHighlightSelectedQuote(q, 'important', element.id);
              close();
            }}
          >
            Highlight text
          </button>
        </div>
      )}
    </div>
  );
}
