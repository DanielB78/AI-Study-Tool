import { useRef } from 'react';
import { useKeyboardShortcuts } from '../../canvas/hooks/useKeyboardShortcuts';
import { AiFloatingPanel } from '../../features/ai';
import { GraphEditorPanel } from '../../features/graphs/GraphEditorPanel';
import { RagDebugPanel } from '../../features/rag/ui/RagDebugPanel';
import { StructureLibraryPanel } from '../../features/structures';
import { FloatingToolPalette } from './FloatingToolPalette';
import { ContextualToolbar } from './ContextualToolbar';

/** Screen-space chrome over the canvas (does not pan/zoom with the board). */
export function EditorChrome() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcuts(fileInputRef);

  return (
    <>
      <FloatingToolPalette fileInputRef={fileInputRef} />
      <ContextualToolbar />
      <GraphEditorPanel />
      <AiFloatingPanel />
      <StructureLibraryPanel />
      {import.meta.env.DEV && <RagDebugPanel />}
    </>
  );
}
