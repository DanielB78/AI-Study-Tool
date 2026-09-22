import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../../store/canvasStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable ||
    target.classList.contains('text-editor-overlay')
  );
}

export function useKeyboardShortcuts(fileInputRef: React.RefObject<HTMLInputElement | null>) {
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      useCanvasStore.getState().hydrate();
      hydrated.current = true;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useCanvasStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        store.setSpacePanning(true);
        return;
      }

      if (isTypingTarget(e.target) || store.editingTextId || store.editingShapeLabelId) {
        return;
      }

      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if ((meta && e.key.toLowerCase() === 'z' && e.shiftKey) || (meta && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        store.copySelected();
        return;
      }
      if (meta && e.key.toLowerCase() === 'v') {
        // Image paste handled separately via paste event; text-ish paste of elements here.
        if (store.clipboard.length > 0) {
          e.preventDefault();
          store.pasteClipboard();
        }
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }
      if (meta && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        store.toggleLockSelected();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.deleteSelected();
        return;
      }

      if (e.key === 'Enter' && store.selectedIds.length === 1) {
        const el = store.document.elements.find((item) => item.id === store.selectedIds[0]);
        if (el?.type === 'text') {
          e.preventDefault();
          store.pushHistory();
          store.setEditingTextId(el.id);
          return;
        }
      }

      if (e.key === 'Escape') {
        store.clearSelection();
        store.setDraftPoints(null);
        store.setDraftShape(null);
        store.setEditingTextId(null);
        store.setEditingShapeLabelId(null);
        store.setTool('select');
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case 'v':
          if (!meta) store.setTool('select');
          break;
        case 'h':
          store.setTool('pan');
          break;
        case 't':
          store.setTool('text');
          break;
        case 'p':
          store.setTool('pen');
          break;
        case 'r':
          store.setTool('rectangle');
          break;
        case 'o':
          store.setTool('ellipse');
          break;
        case 'l':
          store.setTool('line');
          break;
        case 'a':
          store.setTool('arrow');
          break;
        case 'i':
          fileInputRef.current?.click();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        useCanvasStore.getState().setSpacePanning(false);
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || useCanvasStore.getState().editingTextId) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const cam = useCanvasStore.getState().document.camera;
          // Paste near viewport center in world coords.
          const worldX = (window.innerWidth / 2 - cam.x) / cam.zoom;
          const worldY = (window.innerHeight / 2 - cam.y) / cam.zoom;
          await useCanvasStore.getState().addImageFromFile(file, worldX, worldY);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [fileInputRef]);
}
