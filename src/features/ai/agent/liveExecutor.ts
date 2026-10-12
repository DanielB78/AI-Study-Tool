/**
 * Live wiring of the agent executor to the canvas Zustand store.
 */

import { useCanvasStore } from '../../../store/canvasStore';
import { useStructureStore } from '../../structures/structureStore';
import type { AgentExecutorTarget } from './executor';
import { executeCanvasOperations } from './executor';
import type { CanvasAgentResponse, CanvasOperation } from './operations';
import { getDefaultViewportSize } from '../canvas/placement';

export function createLiveAgentExecutorTarget(): AgentExecutorTarget {
  return {
    getCamera: () => useCanvasStore.getState().document.camera,
    getElements: () => useCanvasStore.getState().document.elements,
    getStyle: () => useCanvasStore.getState().style,
    nextZIndex: () => useCanvasStore.getState().nextZIndex(),
    getBoardId: () => useCanvasStore.getState().document.id,
    beginInteraction: () => useCanvasStore.getState().beginInteraction(),
    endInteraction: () => useCanvasStore.getState().endInteraction(),
    rollbackInteraction: () => useCanvasStore.getState().rollbackInteraction(),
    addElement: (element, select) => useCanvasStore.getState().addElement(element, select),
    updateElement: (id, updater) => useCanvasStore.getState().updateElement(id, updater),
    deleteElements: (ids) => {
      const store = useCanvasStore.getState();
      const idSet = new Set(ids);
      store.replaceElements(
        store.document.elements.filter((el) => !idSet.has(el.id)),
      );
    },
    setSelection: (ids) => useCanvasStore.getState().select(ids),
    persist: () => useCanvasStore.getState().persist(),
    getViewportSize: getDefaultViewportSize,
    getStructureById: (id) => useStructureStore.getState().getStructureById(id),
  };
}

export function executeAgentOperationsLive(
  plan: readonly CanvasOperation[] | CanvasAgentResponse,
) {
  return executeCanvasOperations(plan, createLiveAgentExecutorTarget());
}
