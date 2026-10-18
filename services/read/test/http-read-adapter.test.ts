// Spec 02 §3.2, §3.3 and RE2: the read adapters, against the Spec 00 msw
// doubles (CE2), and against hand built responses where a row needs a
// response no double gives.
import {
  ProviderReadResultSchema,
  contractBounds,
  formatEntityTag,
  parseEntityTag,
  type ProviderIdentifier,
} from '@demo/contracts';
import {
  startProviderDoubles,
  syntheticProviderConnections,
  type ProviderDoubles,
} from '@demo/test-doubles';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHttpReadAdapter, readPathSettings } from '../src/index';

let providerDoubles: ProviderDoubles;
// What each request carried, recorded as plain values. A throwing listener
// would make msw answer 500, so this stays simple and is never undefined.
interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
}
let sentRequests: SentRequest[] = [];

beforeAll(() => {
  providerDoubles = startProviderDoubles();
  providerDoubles.server.events.on('request:start', ({ request }) => {
    sentRequests.push({
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
    });
  });
});

afterEach(() => {
  providerDoubles.reset();
});

afterAll(() => {
  providerDoubles.stop();
});

function connectionFor(providerId: ProviderIdentifier) {
  const connection = syntheticProviderConnections.find(
    (candidateConnection) => candidateConnection.providerId === providerId,
  );
  if (connection === undefined) {
    throw new Error(`no double for ${providerId}`);
  }
  return connection;
}

function adapterFor(
  providerId: ProviderIdentifier,
  options: { fetchImplementation?: typeof fetch; apiKey?: string } = {},
) {
  const connection = connectionFor(providerId);
  return createHttpReadAdapter({
    providerId,
    baseUrl: connection.baseUrl,
    readApiKey: () => Promise.resolve(options.apiKey ?? connection.apiKey),
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
  });
}

const callOptions = () => ({
  abortSignal: AbortSignal.timeout(10_000),
  correlationId: '01JB0000000000000000000009',
});

function readOf(providerId: ProviderIdentifier, recordId: string, ifNoneMatchVersion?: string) {
  return adapterFor(providerId).read(
    {
      tenantId: 'tenant-1',
      recordId,
      ...(ifNoneMatchVersion === undefined ? {} : { ifNoneMatchVersion }),
    },
    callOptions(),
  );
}

// A response built by hand, for rows no double produces.
function respondWith(response: () => Response): typeof fetch {
  return () => Promise.resolve(response());
}

// Node.js defines no global BodyInit without the DOM lib.
type ResponseBody = ConstructorParameters<typeof Response>[0];

function providerResponse(
  body: ResponseBody,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ETag: '"0123456789abcdef"',
      'Cache-Control': 'max-age=60',
      'Demo-Provider-Contract': '1',
      ...headers,
    },
  });
}

const validBody = JSON.stringify({
  recordId: 'record-0001',
  updatedAt: '2026-10-18T09:30:00.000Z',
  sections: { summary: { title: 'Synthetic summary', status: 'active' } },
});

function readThrough(fetchImplementation: typeof fetch, recordId = 'record-0001') {
  return adapterFor('provider-a', { fetchImplementation }).read(
    { tenantId: 'tenant-1', recordId },
    callOptions(),
  );
}

describe('the requests an adapter sends', () => {
  it('carry X-Api-Key, Demo-Tenant-Id and X-Correlation-Id, and no If-None-Match without a version', async () => {
    sentRequests = [];
    await readOf('provider-a', 'record-0001');
    const [sentRequest] = sentRequests;
    expect(sentRequest?.url).toBe(`${connectionFor('provider-a').baseUrl}/records/record-0001`);
    expect(sentRequest?.method).toBe('GET');
    expect(sentRequest?.headers.get('X-Api-Key')).toBe(connectionFor('provider-a').apiKey);
    expect(sentRequest?.headers.get('Demo-Tenant-Id')).toBe('tenant-1');
    expect(sentRequest?.headers.get('X-Correlation-Id')).toBe('01JB0000000000000000000009');
    expect(sentRequest?.headers.has('If-None-Match')).toBe(false);
  });

  it('carry If-None-Match as a strong entity tag when a version is known', async () => {
    sentRequests = [];
    await readOf('provider-a', 'record-0001', '0123456789abcdef');
    expect(sentRequests[0]?.headers.get('If-None-Match')).toBe('"0123456789abcdef"');
  });

  it('read the API key once, however many calls are made', async () => {
    let apiKeyReads = 0;
    const adapter = createHttpReadAdapter({
      providerId: 'provider-a',
      baseUrl: connectionFor('provider-a').baseUrl,
      readApiKey: () => {
        apiKeyReads += 1;
        return Promise.resolve(connectionFor('provider-a').apiKey);
      },
    });
    await adapter.read({ tenantId: 'tenant-1', recordId: 'record-0001' }, callOptions());
    await adapter.read({ tenantId: 'tenant-1', recordId: 'record-0002' }, callOptions());
    expect(apiKeyReads).toBe(1);
  });
});

describe('every row of Spec 02 §3.3', () => {
  it('200 with every check passing is ok, with version, updatedAt, sections and ttl', async () => {
    const result = await readOf('provider-a', 'record-0001');
    expect(result.outcome).toBe('ok');
    expect(result.sections && Object.keys(result.sections)).toEqual(['summary', 'tasks']);
    expect(result.updatedAt).toMatch(/^2026-10-/);
    expect(result.ttlSeconds).toBe(60);
    expect(result.version).toMatch(/^[0-9a-f]{16}$/);
    expect(ProviderReadResultSchema.safeParse(result).success).toBe(true);
  });

  it('304 is not-modified, with the version and ttl', async () => {
    const current = await readOf('provider-b', 'record-0002');
    const result = await readOf('provider-b', 'record-0002', current.version);
    expect(result).toEqual({ outcome: 'not-modified', version: current.version, ttlSeconds: 60 });
  });

  it('404 is not-found, which is not a failure', async () => {
    expect(await readOf('provider-c', 'record-0006')).toEqual({
      outcome: 'not-found',
      ttlSeconds: 0,
    });
  });

  it.each([
    ['a 503', 'provider-a', 'down-a-0001'],
    ['a 401 for a refused key', 'provider-b', 'record-0001'],
  ] as const)(
    'any other status, here %s, is error http-status',
    async (caseName, providerId, recordId) => {
      const adapter = adapterFor(
        providerId,
        caseName.includes('401') ? { apiKey: 'refused-key' } : {},
      );
      expect(await adapter.read({ tenantId: 'tenant-1', recordId }, callOptions())).toEqual({
        outcome: 'error',
        errorReason: 'http-status',
        ttlSeconds: 0,
      });
    },
  );

  it('a missing Demo-Provider-Contract is error version-mismatch (oldversion-)', async () => {
    expect(await readOf('provider-c', 'oldversion-0001')).toEqual({
      outcome: 'error',
      errorReason: 'version-mismatch',
      ttlSeconds: 0,
    });
  });

  it('a different Demo-Provider-Contract is error version-mismatch', async () => {
    const result = await readThrough(
      respondWith(() => providerResponse(validBody, { 'Demo-Provider-Contract': '2' })),
    );
    expect(result.errorReason).toBe('version-mismatch');
  });

  it('a body over the bound is error body-too-large (oversize-)', async () => {
    expect(await readOf('provider-a', 'oversize-0001')).toEqual({
      outcome: 'error',
      errorReason: 'body-too-large',
      ttlSeconds: 0,
    });
  });

  it('a max-age over the bound is error header-invalid (badheader-)', async () => {
    expect(await readOf('provider-b', 'badheader-0001')).toEqual({
      outcome: 'error',
      errorReason: 'header-invalid',
      ttlSeconds: 0,
    });
  });

  it.each([
    ['a missing ETag', { ETag: '' }],
    ['a weak ETag', { ETag: 'W/"0123456789abcdef"' }],
    ['an ETag outside the version grammar', { ETag: '"version with spaces"' }],
    ['a malformed Cache-Control', { 'Cache-Control': 'max-age="60"' }],
  ])('%s is error header-invalid', async (_caseName, headerOverrides) => {
    const result = await readThrough(
      respondWith(() => {
        const response = providerResponse(validBody, headerOverrides);
        if ('ETag' in headerOverrides && headerOverrides.ETag === '') {
          response.headers.delete('ETag');
        }
        return response;
      }),
    );
    expect(result.errorReason).toBe('header-invalid');
  });

  it.each([
    ['a body that is not JSON', '{"recordId":'],
    ['a body outside the schema', JSON.stringify({ recordId: 'record-0001' })],
    ['a body for another record', validBody.replace('record-0001', 'record-0002')],
    ['a body that is not UTF-8', new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])],
  ])('%s is error schema-invalid', async (_caseName, body) => {
    expect((await readThrough(respondWith(() => providerResponse(body)))).errorReason).toBe(
      'schema-invalid',
    );
  });

  // Injected rather than sent to an unmatched host: in msw 3.0.3, a refused
  // unmatched request after a cancelled mocked body let a later request to
  // that provider escape interception (the RE2 record). This failure is the
  // one undici raises when a host does not resolve.
  it('a network failure is error transport', async () => {
    const failingFetch: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') }));
    expect(await readThrough(failingFetch)).toEqual({
      outcome: 'error',
      errorReason: 'transport',
      ttlSeconds: 0,
    });
  });

  // §3.1: the fan-out maps an abort to timeout, which the adapter result type
  // cannot express, so the adapter lets the abort through.
  it('lets an abort through for the fan-out to map to timeout (slow-a-)', async () => {
    const adapter = adapterFor('provider-a');
    await expect(
      adapter.read(
        { tenantId: 'tenant-1', recordId: 'slow-a-0001' },
        { abortSignal: AbortSignal.timeout(100), correlationId: '01JB0000000000000000000009' },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('the body bound', () => {
  // A body that never ends: the adapter must stop at the bound, never wait for
  // the end, and never hand any of it to the parser.
  it('stops reading at the bound, and cancels the rest', async () => {
    let bytesPulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(16_384).fill(0x20);
    const endlessBody = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        bytesPulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel: () => {
        cancelled = true;
      },
    });
    const result = await readThrough(respondWith(() => providerResponse(endlessBody)));
    expect(result.errorReason).toBe('body-too-large');
    expect(cancelled).toBe(true);
    expect(bytesPulled).toBeLessThanOrEqual(
      contractBounds.providerResponseBodyMaximumBytes + 2 * chunk.byteLength,
    );
  });

  it('refuses a declared Content-Length over the bound without reading the body', async () => {
    let bodyRead = false;
    // highWaterMark 0: the stream pulls only when someone reads, so a pull
    // means the adapter read it.
    const watchedBody = new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          bodyRead = true;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const result = await readThrough(
      respondWith(() =>
        providerResponse(watchedBody, {
          'Content-Length': String(contractBounds.providerResponseBodyMaximumBytes + 1),
        }),
      ),
    );
    expect(result.errorReason).toBe('body-too-large');
    expect(bodyRead).toBe(false);
  });

  it('accepts a body of exactly the bound', async () => {
    const padding = ' '.repeat(contractBounds.providerResponseBodyMaximumBytes - validBody.length);
    expect(
      (await readThrough(respondWith(() => providerResponse(validBody + padding)))).outcome,
    ).toBe('ok');
  });
});

describe('ttlSeconds', () => {
  it.each([
    ['an absent max-age defaults to RU4', undefined, readPathSettings.defaultTtlSeconds],
    ['a max-age under RU5 is kept', 'max-age=10', 10],
    [
      'a max-age of RU5 is kept',
      `max-age=${String(readPathSettings.maximumTtlSeconds)}`,
      readPathSettings.maximumTtlSeconds,
    ],
    ['a valid max-age over RU5 is capped', 'max-age=86400', readPathSettings.maximumTtlSeconds],
    [
      'a Cache-Control without max-age defaults',
      'no-transform',
      readPathSettings.defaultTtlSeconds,
    ],
  ])('%s', async (_caseName, cacheControl, expectedTtl) => {
    const result = await readThrough(
      respondWith(() => {
        const response = providerResponse(validBody);
        if (cacheControl === undefined) {
          response.headers.delete('Cache-Control');
        } else {
          response.headers.set('Cache-Control', cacheControl);
        }
        return response;
      }),
    );
    expect(result).toMatchObject({ outcome: 'ok', ttlSeconds: expectedTtl });
  });

  it('holds RU4 and RU5 as the author adopted them', () => {
    expect(readPathSettings.defaultTtlSeconds).toBe(60);
    expect(readPathSettings.maximumTtlSeconds).toBe(300);
  });
});

describe('every ordinary synthetic record', () => {
  it('reads ok or not-found from every provider', async () => {
    for (const recordId of ['record-0001', 'record-0002', 'record-0006', 'record-0007']) {
      for (const connection of syntheticProviderConnections) {
        const result = await readOf(connection.providerId, recordId);
        expect(['ok', 'not-found']).toContain(result.outcome);
        if (result.outcome === 'ok') {
          expect(parseEntityTag(formatEntityTag(result.version ?? '')).outcome).toBe('valid');
        }
      }
    }
  });
});
