/**
 * Live wiring of the agent executor to the canvas Zustand store.
 */

import { useCanvasStore } from '../../../store/canvasStore';
import { useStructureStore } from '../../structures/structureStore';
import type { AgentExecutorTarget } from './executor';
import { executeCanvasOperations } from './executor';
import type { CanvasOperation } from './operations';
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
    addElement: (element, select) => useCanvasStore.getState().addElement(element, select),
    updateElement: (id, updater) => useCanvasStore.getState().updateElement(id, updater),
    setSelection: (ids) => useCanvasStore.getState().select(ids),
    persist: () => useCanvasStore.getState().persist(),
    getViewportSize: getDefaultViewportSize,
    getStructureById: (id) => useStructureStore.getState().getStructureById(id),
  };
}

export function executeAgentOperationsLive(operations: readonly CanvasOperation[]) {
  return executeCanvasOperations(operations, createLiveAgentExecutorTarget());
}
