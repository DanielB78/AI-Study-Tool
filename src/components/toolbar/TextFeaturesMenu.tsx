import { useEffect, useRef, useState } from 'react';
import type { TextElement } from '../../types/canvas';
import {
  getSelectedTextQuote,
  uiAddTextComment,
  uiAddTextNote,
  uiHighlightSelectedQuote,
  uiInsertHeading,
  uiRemoveTextTitle,
  uiSetTextTitle,
} from '../../features/text/textFeatureUi';

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

  const hasTitle = !!element.title?.text.trim();

  const close = () => setOpen(false);

  return (
    <div className="ctx-features" ref={rootRef}>
      <button
        type="button"
        className={open ? 'ctx-chip active' : 'ctx-chip'}
        title="Add text features"
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
              const text = window.prompt(
                hasTitle ? 'Edit title' : 'Add title',
                element.title?.text ?? '',
              );
              if (text === null) return;
              if (!text.trim()) uiRemoveTextTitle(element.id);
              else uiSetTextTitle(text, element.id);
              close();
            }}
          >
            {hasTitle ? 'Edit title' : 'Add title'}
          </button>
          {hasTitle && (
            <button
              type="button"
              role="menuitem"
              className="ctx-features-item"
              onClick={() => {
                uiRemoveTextTitle(element.id);
                close();
              }}
            >
              Remove title
            </button>
          )}
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
              uiAddTextComment(
                { quote: q.trim() },
                comment,
                'explanation',
                element.id,
              );
              close();
            }}
          >
            Add comment
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Supplementary note');
              if (!text?.trim()) return;
              uiAddTextNote(text, 'extra_information', element.id);
              close();
            }}
          >
            Add supplementary note
          </button>
        </div>
      )}
    </div>
  );
}
