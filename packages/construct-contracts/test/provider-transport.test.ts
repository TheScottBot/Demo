// Spec 00 §2.3 and §4.1, a Spec 00 change made in Spec 03 WE4: the provider
// transport pieces every adapter needs, on the runtime subpath, so the read
// and write paths share them without importing each other.
import { describe, expect, it, vi } from 'vitest';
import {
  createCachedApiKeyReader,
  parseProviderEndpoint,
  readResponseBodyWithinBound,
} from '../src/runtime/index';

function chunkedResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const nextChunk = chunks.shift();
      if (nextChunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(nextChunk);
      }
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return { response: new Response(body, { headers }), wasCancelled: () => cancelled };
}

describe('readResponseBodyWithinBound (datum 0.10)', () => {
  it('reads a body within the bound, across chunks', async () => {
    const { response } = chunkedResponse([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect(await readResponseBodyWithinBound(response, 3)).toEqual({
      outcome: 'read',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('stops at the first chunk that crosses the bound, and cancels the rest unread', async () => {
    const { response, wasCancelled } = chunkedResponse([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5]),
    ]);
    expect(await readResponseBodyWithinBound(response, 3)).toEqual({ outcome: 'too-large' });
    expect(wasCancelled()).toBe(true);
  });

  it('refuses a declared length over the bound before reading any of it', async () => {
    const { response, wasCancelled } = chunkedResponse([new Uint8Array([1])], {
      'content-length': '4',
    });
    expect(await readResponseBodyWithinBound(response, 3)).toEqual({ outcome: 'too-large' });
    expect(wasCancelled()).toBe(true);
  });

  it('reads an absent body as no bytes', async () => {
    expect(await readResponseBodyWithinBound(new Response(null, { status: 204 }), 3)).toEqual({
      outcome: 'read',
      bytes: new Uint8Array(),
    });
  });
});

describe('createCachedApiKeyReader (Spec 00 §2.3)', () => {
  it('reads the key once per execution environment', async () => {
    const readApiKey = vi.fn(() => Promise.resolve('synthetic-key'));
    const apiKey = createCachedApiKeyReader(readApiKey);
    expect(await apiKey()).toBe('synthetic-key');
    expect(await apiKey()).toBe('synthetic-key');
    expect(readApiKey).toHaveBeenCalledTimes(1);
  });

  it('keeps no failed read, so the next call tries again', async () => {
    const readApiKey = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('ThrottlingException'))
      .mockResolvedValueOnce('synthetic-key');
    const apiKey = createCachedApiKeyReader(readApiKey);
    await expect(apiKey()).rejects.toThrow('ThrottlingException');
    expect(await apiKey()).toBe('synthetic-key');
    expect(readApiKey).toHaveBeenCalledTimes(2);
  });
});

describe('parseProviderEndpoint (Spec 00 §2.3, CQ6)', () => {
  const secretArn =
    'arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/provider-a-AbCdEf';

  it.each([
    'https://provider-a.providers.example.test',
    'http://127.0.0.1:4101',
    'http://localhost:4101',
  ])('accepts %s', (baseUrl) => {
    expect(parseProviderEndpoint({ baseUrl, secretArn })).toEqual({ baseUrl, secretArn });
  });

  it.each([
    ['plain http to another host', { baseUrl: 'http://provider-a.example.test', secretArn }],
    ['a missing base URL', { baseUrl: undefined, secretArn }],
    [
      'a secret value in place of its ARN',
      { baseUrl: 'https://provider-a.example.test', secretArn: 'synthetic-key' },
    ],
  ])('refuses %s', (_caseName, endpoint) => {
    expect(() => parseProviderEndpoint(endpoint)).toThrow();
  });
});
