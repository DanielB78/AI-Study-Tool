import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestAiStore } from '../state/aiStore';
import type { AiService } from '../data/aiService';
import { AiRequestError, AI_USER_ERROR_MESSAGE } from '../models/types';

function mockService(
  impl: AiService['sendPrompt'] = async (prompt) => ({ text: `echo:${prompt}` }),
): AiService {
  return { sendPrompt: vi.fn(impl) };
}

describe('aiStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty prompts without calling the service', async () => {
    const service = mockService();
    const store = createTestAiStore(service);
    store.getState().setPrompt('   ');
    await store.getState().sendPrompt();
    expect(service.sendPrompt).not.toHaveBeenCalled();
    expect(store.getState().status).not.toBe('loading');
  });

  it('enters loading then success', async () => {
    let resolve!: (value: { text: string }) => void;
    const pending = new Promise<{ text: string }>((r) => {
      resolve = r;
    });
    const service = mockService(() => pending);
    const store = createTestAiStore(service);

    store.getState().setPrompt('Explain Gauss\'s law simply');
    const sendPromise = store.getState().sendPrompt();

    expect(store.getState().status).toBe('loading');
    expect(store.getState().expanded).toBe(true);
    expect(store.getState().responseVisible).toBe(true);

    resolve({ text: 'Gauss\'s law relates electric flux to enclosed charge.' });
    await sendPromise;

    expect(store.getState().status).toBe('success');
    expect(store.getState().responseText).toContain('electric flux');
    expect(store.getState().prompt).toBe('');
    expect(store.getState().lastPrompt).toBe('Explain Gauss\'s law simply');
    expect(service.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('enters error state with a friendly message', async () => {
    const service = mockService(async () => {
      throw new AiRequestError(AI_USER_ERROR_MESSAGE, 'network_error');
    });
    const store = createTestAiStore(service);
    store.getState().setPrompt('hello');
    await store.getState().sendPrompt();

    expect(store.getState().status).toBe('error');
    expect(store.getState().errorMessage).toBe(AI_USER_ERROR_MESSAGE);
    expect(store.getState().responseVisible).toBe(true);
  });

  it('does not start a duplicate request while loading', async () => {
    let resolve!: (value: { text: string }) => void;
    const pending = new Promise<{ text: string }>((r) => {
      resolve = r;
    });
    const service = mockService(() => pending);
    const store = createTestAiStore(service);

    store.getState().setPrompt('one');
    const first = store.getState().sendPrompt();
    expect(store.getState().status).toBe('loading');

    // Attempt another send without resolving the first.
    await store.getState().sendPrompt();
    expect(service.sendPrompt).toHaveBeenCalledTimes(1);

    resolve({ text: 'done' });
    await first;
    expect(store.getState().status).toBe('success');
  });

  it('closeResponse clears the floating answer', async () => {
    const service = mockService(async () => ({ text: 'answer' }));
    const store = createTestAiStore(service);
    store.getState().setPrompt('q');
    await store.getState().sendPrompt();
    store.getState().closeResponse();

    expect(store.getState().responseVisible).toBe(false);
    expect(store.getState().responseText).toBeNull();
    expect(store.getState().status).toBe('idle');
  });
});
