import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiService } from '../data/aiService';
import { AI_USER_ERROR_MESSAGE } from '../models/types';

describe('aiService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts prompt and returns text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'hello world' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = createAiService('http://example.test');
    const result = await service.sendPrompt('  hi  ');

    expect(result).toEqual({ text: 'hello world' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'hi' }),
      }),
    );
  });

  it('maps HTTP failures to a friendly error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'provider_error', message: 'nope' } }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const service = createAiService('http://example.test');
    await expect(service.sendPrompt('hi')).rejects.toMatchObject({
      message: AI_USER_ERROR_MESSAGE,
      code: 'provider_error',
    });
  });

  it('maps network failures to a friendly error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const service = createAiService('http://example.test');
    await expect(service.sendPrompt('hi')).rejects.toMatchObject({
      message: AI_USER_ERROR_MESSAGE,
      code: 'network_error',
    });
  });
});
