import {
  ProviderReadResponseBodySchema,
  ProviderWriteResponseBodySchema,
  contractBounds,
  formatEntityTag,
  mockProviderBehaviour,
  parseCacheControlMaxAge,
  parseEntityTag,
  type ProviderIdentifier,
} from '@demo/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeProviderVersion,
  createInMemoryProviderStore,
  simulateProviderRequest,
  type InMemoryProviderStore,
  type ProviderSimulationRequest,
  type ProviderSimulationResponse,
} from '../src/index';

const fixedNow = new Date('2026-10-18T12:00:00.000Z');
const idempotencyKey = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const secondIdempotencyKey = '6a1d2c3b-4e5f-4a6b-9c7d-8e9f0a1b2c3d';

let store: InMemoryProviderStore;
let currentTime: Date;
let mintedUlidCount: number;

beforeEach(() => {
  store = createInMemoryProviderStore();
  currentTime = fixedNow;
  mintedUlidCount = 0;
});

function simulate(
  providerId: ProviderIdentifier,
  request: Partial<ProviderSimulationRequest> & { path: string },
  headerOverrides: Record<string, string | undefined> = {},
): Promise<ProviderSimulationResponse> {
  const headers: Record<string, string | undefined> = {
    'x-api-key': `synthetic-api-key-${providerId}`,
    'demo-tenant-id': 'tenant-1',
    ...headerOverrides,
  };
  return simulateProviderRequest(
    {
      method: request.method ?? 'GET',
      path: request.path,
      headers,
      bodyText: request.bodyText,
    },
    {
      providerId,
      apiKey: `synthetic-api-key-${providerId}`,
      store,
      now: () => currentTime,
      mintUlid: () => {
        mintedUlidCount += 1;
        return `01JC${String(mintedUlidCount).padStart(22, '0')}`;
      },
    },
  );
}

async function currentEntityTag(providerId: ProviderIdentifier, recordId: string): Promise<string> {
  const readResponse = await simulate(providerId, { path: `/records/${recordId}` });
  const entityTag = readResponse.headers['ETag'];
  if (entityTag === undefined) {
    throw new Error('expected an ETag');
  }
  return entityTag;
}

async function replaceSummary(
  recordId: string,
  headerOverrides: Record<string, string | undefined> = {},
  title = 'Synthetic replacement title',
): Promise<ProviderSimulationResponse> {
  return simulate(
    'provider-a',
    {
      method: 'PUT',
      path: `/records/${recordId}/sections/summary`,
      bodyText: JSON.stringify({ title, status: 'paused' }),
    },
    {
      'if-match': await currentEntityTag('provider-a', recordId),
      'idempotency-key': idempotencyKey,
      ...headerOverrides,
    },
  );
}

describe('authentication and tenancy', () => {
  it.each([
    ['a missing API key', { 'x-api-key': undefined }],
    ['a wrong API key', { 'x-api-key': 'synthetic-api-key-provider-b' }],
  ])('answers %s with 401', async (_caseName, headerOverrides) => {
    const response = await simulate(
      'provider-a',
      { path: '/records/record-0001' },
      headerOverrides,
    );
    expect(response.status).toBe(401);
  });

  it.each([
    ['a missing tenant', { 'demo-tenant-id': undefined }],
    ['a malformed tenant', { 'demo-tenant-id': 'tenant.1' }],
  ])('answers %s with 400', async (_caseName, headerOverrides) => {
    const response = await simulate(
      'provider-a',
      { path: '/records/record-0001' },
      headerOverrides,
    );
    expect(response.status).toBe(400);
  });

  it('keeps tenants apart under the same record identifier', async () => {
    const firstTenant = await simulate('provider-a', { path: '/records/record-0001' });
    const secondTenant = await simulate(
      'provider-a',
      { path: '/records/record-0001' },
      { 'demo-tenant-id': 'tenant-2' },
    );
    expect(firstTenant.bodyText).not.toBe(secondTenant.bodyText);
    expect(firstTenant.headers['ETag']).not.toBe(secondTenant.headers['ETag']);
  });

  it('answers an unknown tenant as not held', async () => {
    const response = await simulate(
      'provider-a',
      { path: '/records/record-0001' },
      { 'demo-tenant-id': 'tenant-3' },
    );
    expect(response.status).toBe(404);
  });
});

describe('routing', () => {
  it.each([
    ['an unknown path', 'GET', '/records'],
    ['an unknown method', 'DELETE', '/records/record-0001'],
    ['an unknown sub path', 'GET', '/records/record-0001/sections/summary'],
  ])('answers %s with 404', async (_caseName, method, path) => {
    expect((await simulate('provider-a', { method, path })).status).toBe(404);
  });

  it('answers a record identifier outside the grammar with 400', async () => {
    expect((await simulate('provider-a', { path: '/records/record%200001' })).status).toBe(400);
  });
});

describe('reads', () => {
  it('answer 200 with the provider’s own sections, its ETag, max-age and contract version', async () => {
    const response = await simulate('provider-a', { path: '/records/record-0001' });
    expect(response.status).toBe(200);
    expect(response.delayMilliseconds).toBe(0);
    const body = ProviderReadResponseBodySchema.parse(JSON.parse(response.bodyText ?? ''));
    expect(Object.keys(body.sections)).toEqual(['summary', 'tasks']);
    expect(response.headers['ETag']).toBe(formatEntityTag(computeProviderVersion(body.sections)));
    expect(response.headers['Cache-Control']).toBe(
      `max-age=${String(mockProviderBehaviour.cacheMaxAgeSeconds)}`,
    );
    expect(response.headers['Demo-Provider-Contract']).toBe('1');
    expect(response.headers['Content-Type']).toBe('application/json');
  });

  it('answer 404 when the provider holds no section of the record', async () => {
    expect((await simulate('provider-c', { path: '/records/record-0006' })).status).toBe(404);
    expect((await simulate('provider-a', { path: '/records/record-9999' })).status).toBe(404);
  });

  it('answer 304 when If-None-Match carries the current ETag, and 200 otherwise', async () => {
    const entityTag = await currentEntityTag('provider-b', 'record-0002');
    const notModified = await simulate(
      'provider-b',
      { path: '/records/record-0002' },
      { 'if-none-match': entityTag },
    );
    expect(notModified.status).toBe(304);
    expect(notModified.bodyText).toBeUndefined();
    expect(notModified.headers['ETag']).toBe(entityTag);
    const modified = await simulate(
      'provider-b',
      { path: '/records/record-0002' },
      { 'if-none-match': '"0000000000000000"' },
    );
    expect(modified.status).toBe(200);
  });
});

describe('read faults', () => {
  it('slow-a- delays provider-a by CU9 and no other provider', async () => {
    const slowed = await simulate('provider-a', { path: '/records/slow-a-0001' });
    expect(slowed.status).toBe(200);
    expect(slowed.delayMilliseconds).toBe(mockProviderBehaviour.slowResponseDelayMilliseconds);
    const unaffected = await simulate('provider-b', { path: '/records/slow-a-0001' });
    expect(unaffected.delayMilliseconds).toBe(0);
  });

  it('down-b- makes provider-b answer 503 and leaves provider-a alone', async () => {
    expect((await simulate('provider-b', { path: '/records/down-b-0001' })).status).toBe(503);
    expect((await simulate('provider-a', { path: '/records/down-b-0001' })).status).toBe(200);
  });

  it('oldversion- omits Demo-Provider-Contract on reads', async () => {
    const response = await simulate('provider-c', { path: '/records/oldversion-0001' });
    expect(response.status).toBe(200);
    expect(response.headers['Demo-Provider-Contract']).toBeUndefined();
  });

  it('oversize- returns a body over the provider bound', async () => {
    const response = await simulate('provider-a', { path: '/records/oversize-0001' });
    expect(response.status).toBe(200);
    expect(new TextEncoder().encode(response.bodyText ?? '').byteLength).toBeGreaterThan(
      contractBounds.providerResponseBodyMaximumBytes,
    );
  });

  it('badheader- returns a max-age beyond the bound', async () => {
    const response = await simulate('provider-b', { path: '/records/badheader-0001' });
    expect(response.status).toBe(200);
    expect(parseCacheControlMaxAge(response.headers['Cache-Control'])).toEqual({
      outcome: 'invalid',
    });
  });
});

describe('replace writes', () => {
  it('apply the section, answer 200 with the new ETag and contract version', async () => {
    const previousEntityTag = await currentEntityTag('provider-a', 'record-0003');
    const response = await replaceSummary('record-0003');
    expect(response.status).toBe(200);
    expect(ProviderWriteResponseBodySchema.parse(JSON.parse(response.bodyText ?? ''))).toEqual({
      recordId: 'record-0003',
      section: 'summary',
      updatedAt: fixedNow.toISOString(),
    });
    expect(response.headers['Demo-Provider-Contract']).toBe('1');
    expect(response.headers['ETag']).not.toBe(previousEntityTag);
    const reread = await simulate('provider-a', { path: '/records/record-0003' });
    expect(reread.headers['ETag']).toBe(response.headers['ETag']);
    const rereadBody = ProviderReadResponseBodySchema.parse(JSON.parse(reread.bodyText ?? ''));
    expect(rereadBody.sections.summary).toEqual({
      title: 'Synthetic replacement title',
      status: 'paused',
    });
    expect(rereadBody.updatedAt).toBe(fixedNow.toISOString());
  });

  it('answer 428 without If-Match', async () => {
    expect((await replaceSummary('record-0003', { 'if-match': undefined })).status).toBe(428);
  });

  it.each([
    ['a missing Idempotency-Key', { 'idempotency-key': undefined }],
    ['a malformed Idempotency-Key', { 'idempotency-key': 'not-a-uuid' }],
    ['a malformed If-Match', { 'if-match': 'W/"weak"' }],
  ])('answer %s with 400', async (_caseName, headerOverrides) => {
    expect((await replaceSummary('record-0003', headerOverrides)).status).toBe(400);
  });

  it('answer 412 when If-Match is stale', async () => {
    expect((await replaceSummary('record-0003', { 'if-match': '"0000000000000000"' })).status).toBe(
      412,
    );
  });

  it('answer 400 for a body outside the section shape', async () => {
    const response = await simulate(
      'provider-a',
      {
        method: 'PUT',
        path: '/records/record-0003/sections/summary',
        bodyText: JSON.stringify({ title: 'x', status: 'archived' }),
      },
      {
        'if-match': await currentEntityTag('provider-a', 'record-0003'),
        'idempotency-key': idempotencyKey,
      },
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ['a section another provider owns', 'provider-a', '/records/record-0003/sections/schedule'],
    ['notes by replace', 'provider-b', '/records/record-0003/sections/notes'],
    ['an unknown section', 'provider-a', '/records/record-0003/sections/attachments'],
    [
      'a record the provider holds nothing of',
      'provider-c',
      '/records/record-0006/sections/preferences',
    ],
  ] as const)('answer 404 for %s', async (_caseName, providerId, path) => {
    const response = await simulate(
      providerId,
      { method: 'PUT', path, bodyText: '{}' },
      { 'if-match': '"0000000000000000"', 'idempotency-key': idempotencyKey },
    );
    expect(response.status).toBe(404);
  });
});

describe('idempotency', () => {
  it('replays the stored response for a repeated key and applies nothing twice', async () => {
    // A client retrying sends exactly what it sent before, including the
    // If-Match it read then, which the first attempt has since made stale.
    const originalEntityTag = await currentEntityTag('provider-a', 'record-0004');
    const firstResponse = await replaceSummary('record-0004', { 'if-match': originalEntityTag });
    currentTime = new Date(fixedNow.getTime() + 60_000);
    const replayed = await replaceSummary('record-0004', { 'if-match': originalEntityTag });
    expect(replayed).toEqual(firstResponse);
    const reread = await simulate('provider-a', { path: '/records/record-0004' });
    expect(reread.headers['ETag']).toBe(firstResponse.headers['ETag']);
  });

  it('answers 422 for a repeated key with a different request', async () => {
    const firstResponse = await replaceSummary('record-0004');
    const differentRequest = await replaceSummary(
      'record-0004',
      { 'if-match': firstResponse.headers['ETag'] },
      'Synthetic different title',
    );
    expect(differentRequest.status).toBe(422);
  });

  it('treats a key as new once the CU11 replay window has passed', async () => {
    const firstResponse = await replaceSummary('record-0004');
    currentTime = new Date(
      fixedNow.getTime() + (mockProviderBehaviour.idempotentReplayWindowSeconds + 1) * 1_000,
    );
    const afterWindow = await replaceSummary(
      'record-0004',
      { 'if-match': firstResponse.headers['ETag'] },
      'Synthetic later title',
    );
    expect(afterWindow.status).toBe(200);
    expect(afterWindow.headers['ETag']).not.toBe(firstResponse.headers['ETag']);
  });

  it('scopes keys by tenant', async () => {
    await replaceSummary('record-0004');
    const otherTenant = await simulate(
      'provider-a',
      {
        method: 'PUT',
        path: '/records/record-0004/sections/summary',
        bodyText: JSON.stringify({ title: 'Synthetic replacement title', status: 'paused' }),
      },
      {
        'demo-tenant-id': 'tenant-2',
        'if-match': (
          await simulate(
            'provider-a',
            { path: '/records/record-0004' },
            { 'demo-tenant-id': 'tenant-2' },
          )
        ).headers['ETag'],
        'idempotency-key': idempotencyKey,
      },
    );
    expect(otherTenant.status).toBe(200);
  });
});

describe('notes appends', () => {
  async function appendNote(
    providerId: ProviderIdentifier,
    recordId: string,
  ): Promise<ProviderSimulationResponse> {
    return simulate(
      providerId,
      {
        method: 'POST',
        path: `/records/${recordId}/sections/notes/entries`,
        bodyText: JSON.stringify({ text: 'Synthetic appended note' }),
      },
      {
        'if-match': (await simulate(providerId, { path: `/records/${recordId}` })).headers['ETag'],
        'idempotency-key': secondIdempotencyKey,
      },
    );
  }

  it('mint the note identifier and time, answer 201, and append in order', async () => {
    const response = await appendNote('provider-b', 'record-0005');
    expect(response.status).toBe(201);
    expect(ProviderWriteResponseBodySchema.parse(JSON.parse(response.bodyText ?? ''))).toEqual({
      recordId: 'record-0005',
      section: 'notes',
      updatedAt: fixedNow.toISOString(),
    });
    expect(parseEntityTag(response.headers['ETag']).outcome).toBe('valid');
    expect(response.headers['Demo-Provider-Contract']).toBe('1');
    const reread = ProviderReadResponseBodySchema.parse(
      JSON.parse((await simulate('provider-b', { path: '/records/record-0005' })).bodyText ?? ''),
    );
    expect(reread.sections.notes?.entries.at(-1)).toEqual({
      noteId: '01JC0000000000000000000001',
      writtenAt: fixedNow.toISOString(),
      text: 'Synthetic appended note',
    });
  });

  it('answer 404 on a provider that does not own notes', async () => {
    expect((await appendNote('provider-a', 'record-0005')).status).toBe(404);
  });
});

describe('write faults', () => {
  async function replaceOn(recordId: string, key = idempotencyKey) {
    return replaceSummary(recordId, { 'idempotency-key': key });
  }

  it('flaky- answers 503 twice per key, then applies, then replays', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await replaceOn('flaky-0001')).status);
    }
    expect(statuses).toEqual([503, 503, 200, 200]);
    expect((await replaceOn('flaky-0001', secondIdempotencyKey)).status).toBe(503);
  });

  it('throttle- answers 429 with the CU11 Retry-After once per key', async () => {
    const throttled = await replaceOn('throttle-0001');
    expect(throttled.status).toBe(429);
    expect(throttled.headers['Retry-After']).toBe(
      String(mockProviderBehaviour.throttleRetryAfterSeconds),
    );
    expect((await replaceOn('throttle-0001')).status).toBe(200);
  });

  it('poison- always answers 500', async () => {
    expect((await replaceOn('poison-0001')).status).toBe(500);
    expect((await replaceOn('poison-0001')).status).toBe(500);
  });

  it('conflict- always answers 412', async () => {
    expect((await replaceOn('conflict-0001')).status).toBe(412);
    expect((await replaceOn('conflict-0001')).status).toBe(412);
  });

  it('slow- and down- apply to writes too', async () => {
    const slowed = await simulate(
      'provider-c',
      {
        method: 'PUT',
        path: '/records/slow-c-0001/sections/preferences',
        bodyText: JSON.stringify({ contactWindow: 'evening', language: 'en-GB' }),
      },
      {
        'if-match': await currentEntityTag('provider-c', 'slow-c-0001'),
        'idempotency-key': idempotencyKey,
      },
    );
    expect(slowed.status).toBe(200);
    expect(slowed.delayMilliseconds).toBe(mockProviderBehaviour.slowResponseDelayMilliseconds);
    // down- also refuses the read, so the write carries a made up If-Match;
    // the provider answers 503 before it looks at it.
    const downWrite = await simulate(
      'provider-a',
      {
        method: 'PUT',
        path: '/records/down-a-0001/sections/summary',
        bodyText: JSON.stringify({ title: 'Synthetic title', status: 'active' }),
      },
      { 'if-match': '"0000000000000000"', 'idempotency-key': idempotencyKey },
    );
    expect(downWrite.status).toBe(503);
  });

  it('read only faults leave writes alone', async () => {
    const response = await replaceOn('oldversion-0001');
    expect(response.status).toBe(200);
    expect(response.headers['Demo-Provider-Contract']).toBe('1');
  });
});
