import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { useCanvasStore } from './store/canvasStore';
import { debugRetrieve } from './features/rag';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development-only RAG inspection (not production UI).
if (import.meta.env.DEV) {
  (window as unknown as { __RAG_DEBUG__: unknown }).__RAG_DEBUG__ = {
    debugRetrieve: (prompt: string) => {
      const boardId = useCanvasStore.getState().document.id;
      return debugRetrieve(boardId, prompt, (id) => {
        const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
        return el?.type === 'text' ? el : undefined;
      });
    },
    getBoardId: () => useCanvasStore.getState().document.id,
  };
}
