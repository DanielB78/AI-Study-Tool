import { useCanvasStore } from '../../../store/canvasStore';
import { insertAiTextResponse, type AiCanvasInsertTarget } from './insertAiText';

/** Wire AI insertion to the live canvas store (undoable addElement). */
export function createLiveAiCanvasInsertTarget(): AiCanvasInsertTarget {
  return {
    getCamera: () => useCanvasStore.getState().document.camera,
    getElements: () => useCanvasStore.getState().document.elements,
    getStyle: () => useCanvasStore.getState().style,
    nextZIndex: () => useCanvasStore.getState().nextZIndex(),
    addElement: (element, select) => {
      useCanvasStore.getState().addElement(element, select);
    },
    afterInsert: () => {
      useCanvasStore.setState({
        editingTextId: null,
        editingShapeLabelId: null,
        activeTool: 'select',
      });
    },
  };
}

export function insertAiResponseOntoCanvas(text: string) {
  return insertAiTextResponse(text, createLiveAiCanvasInsertTarget());
}
