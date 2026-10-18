import {
  ProviderReadResponseBodySchema,
  ProviderWriteResponseBodySchema,
  mockProviderBehaviour,
  mockProviderFaults,
  type ProviderIdentifier,
} from '@demo/contracts';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDynamoDbProviderStore,
  createMockProviderHandler,
  seedMockProviderStore,
} from '../src/index';
import {
  createFakeMockProviderTable,
  fakeTableName,
  type FakeMockProviderTable,
} from './support/fake-mock-provider-table';

// Spec 00 CE4: the handlers invoked directly with every row of the §4.3
// tables, against aws-sdk-client-mock.

let fakeTable: FakeMockProviderTable;
let sleptMilliseconds: number[];
let apiKeyReads: number;
let loggedRequests: Record<string, unknown>[];

beforeEach(async () => {
  fakeTable = createFakeMockProviderTable();
  sleptMilliseconds = [];
  apiKeyReads = 0;
  loggedRequests = [];
  await seedMockProviderStore({
    documentClient: fakeTable.documentClient,
    tableName: fakeTableName,
  });
});

afterEach(() => {
  fakeTable.restore();
});

function handlerFor(providerId: ProviderIdentifier) {
  return createMockProviderHandler({
    providerId,
    readApiKey: () => {
      apiKeyReads += 1;
      return Promise.resolve(`synthetic-api-key-${providerId}`);
    },
    store: createDynamoDbProviderStore({
      documentClient: fakeTable.documentClient,
      tableName: fakeTableName,
    }),
    now: () => new Date('2026-10-18T12:00:00.000Z'),
    mintUlid: () => '01JC0000000000000000000001',
    sleep: (milliseconds) => {
      sleptMilliseconds.push(milliseconds);
      return Promise.resolve();
    },
    log: { recordRequest: (requestLine) => loggedRequests.push(requestLine) },
  });
}

function providerEvent(
  providerId: ProviderIdentifier,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string; base64?: boolean } = {},
): APIGatewayProxyEventV2 {
  const body = options.body;
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      'x-api-key': `synthetic-api-key-${providerId}`,
      'demo-tenant-id': 'tenant-1',
      ...options.headers,
    },
    isBase64Encoded: options.base64 ?? false,
    ...(body === undefined
      ? {}
      : { body: options.base64 === true ? Buffer.from(body).toString('base64') : body }),
    requestContext: {
      accountId: '000000000000',
      apiId: 'synthetic',
      domainName: 'synthetic.example.test',
      domainPrefix: 'synthetic',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '192.0.2.1', userAgent: 'synthetic' },
      requestId: 'synthetic',
      routeKey: '$default',
      stage: '$default',
      time: '18/Oct/2026:12:00:00 +0000',
      timeEpoch: 1_792_324_800_000,
    },
  };
}

async function currentEntityTag(providerId: ProviderIdentifier, recordId: string): Promise<string> {
  const response = await handlerFor(providerId)(
    providerEvent(providerId, 'GET', `/records/${recordId}`),
  );
  return String(response.headers?.['ETag']);
}

describe('the §4.3 endpoint table through the handler', () => {
  it('GET answers 200 with the read body, ETag, max-age and contract version', async () => {
    const response = await handlerFor('provider-a')(
      providerEvent('provider-a', 'GET', '/records/record-0001'),
    );
    expect(response.statusCode).toBe(200);
    expect(ProviderReadResponseBodySchema.safeParse(JSON.parse(response.body ?? '')).success).toBe(
      true,
    );
    expect(response.headers?.['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
    expect(response.headers?.['Cache-Control']).toBe('max-age=60');
    expect(response.headers?.['Demo-Provider-Contract']).toBe('1');
  });

  it('GET answers 304 when If-None-Match matches, and 404 when the provider holds nothing', async () => {
    const entityTag = await currentEntityTag('provider-b', 'record-0002');
    const notModified = await handlerFor('provider-b')(
      providerEvent('provider-b', 'GET', '/records/record-0002', {
        headers: { 'if-none-match': entityTag },
      }),
    );
    expect(notModified.statusCode).toBe(304);
    const notHeld = await handlerFor('provider-c')(
      providerEvent('provider-c', 'GET', '/records/record-0006'),
    );
    expect(notHeld.statusCode).toBe(404);
  });

  it('PUT requires If-Match and Idempotency-Key, refuses a stale If-Match, applies, and replays', async () => {
    const path = '/records/record-0003/sections/summary';
    const body = JSON.stringify({ title: 'Synthetic replacement', status: 'paused' });
    const handler = handlerFor('provider-a');
    expect((await handler(providerEvent('provider-a', 'PUT', path, { body }))).statusCode).toBe(
      428,
    );
    const entityTag = await currentEntityTag('provider-a', 'record-0003');
    const headers = {
      'if-match': entityTag,
      'idempotency-key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    };
    expect(
      (
        await handler(
          providerEvent('provider-a', 'PUT', path, {
            body,
            headers: { ...headers, 'if-match': '"0000000000000000"' },
          }),
        )
      ).statusCode,
    ).toBe(412);
    const applied = await handler(providerEvent('provider-a', 'PUT', path, { body, headers }));
    expect(applied.statusCode).toBe(200);
    expect(ProviderWriteResponseBodySchema.safeParse(JSON.parse(applied.body ?? '')).success).toBe(
      true,
    );
    const replayed = await handler(providerEvent('provider-a', 'PUT', path, { body, headers }));
    expect(replayed).toEqual(applied);
  });

  it('POST appends a note, answering 201', async () => {
    const response = await handlerFor('provider-b')(
      providerEvent('provider-b', 'POST', '/records/record-0005/sections/notes/entries', {
        body: JSON.stringify({ text: 'Synthetic appended note' }),
        headers: {
          'if-match': await currentEntityTag('provider-b', 'record-0005'),
          'idempotency-key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
        },
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it('decodes a base64 body as payload format 2.0 may deliver it', async () => {
    const response = await handlerFor('provider-a')(
      providerEvent('provider-a', 'PUT', '/records/record-0003/sections/summary', {
        body: JSON.stringify({ title: 'Synthetic replacement', status: 'paused' }),
        base64: true,
        headers: {
          'if-match': await currentEntityTag('provider-a', 'record-0003'),
          'idempotency-key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
        },
      }),
    );
    expect(response.statusCode).toBe(200);
  });

  it('refuses a missing API key with 401', async () => {
    const response = await handlerFor('provider-a')(
      providerEvent('provider-a', 'GET', '/records/record-0001', {
        headers: { 'x-api-key': 'wrong' },
      }),
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('the §4.3 fault table through the handler', () => {
  const faultCases = mockProviderFaults.map((fault) => [fault.prefix, fault] as const);

  it.each(faultCases)('%s produces its effect', async (prefix, fault) => {
    const [providerId] = fault.providers;
    if (providerId === undefined) {
      throw new Error('a fault names no provider');
    }
    const recordId = `${prefix}0001`;
    const section =
      providerId === 'provider-a'
        ? 'summary'
        : providerId === 'provider-b'
          ? 'schedule'
          : 'preferences';
    const payloads = {
      summary: { title: 'Synthetic replacement', status: 'paused' },
      schedule: { entries: [] },
      preferences: { contactWindow: 'evening', language: 'en-GB' },
    };
    const read = await handlerFor(providerId)(
      providerEvent(providerId, 'GET', `/records/${recordId}`),
    );
    const write = await handlerFor(providerId)(
      providerEvent(providerId, 'PUT', `/records/${recordId}/sections/${section}`, {
        body: JSON.stringify(payloads[section]),
        headers: {
          'if-match': String(read.headers?.['ETag'] ?? '"0000000000000000"'),
          'idempotency-key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
        },
      }),
    );
    switch (fault.effect) {
      case 'delay-response':
        expect(sleptMilliseconds).toEqual([
          mockProviderBehaviour.slowResponseDelayMilliseconds,
          mockProviderBehaviour.slowResponseDelayMilliseconds,
        ]);
        break;
      case 'service-unavailable':
        expect([read.statusCode, write.statusCode]).toEqual([503, 503]);
        break;
      case 'unavailable-for-first-attempts':
        expect(write.statusCode).toBe(503);
        break;
      case 'throttle-once-per-key':
        expect(write.statusCode).toBe(429);
        expect(write.headers?.['Retry-After']).toBe('2');
        break;
      case 'server-error':
        expect(write.statusCode).toBe(500);
        break;
      case 'precondition-failed':
        expect(write.statusCode).toBe(412);
        break;
      case 'omit-contract-header':
        expect(read.headers?.['Demo-Provider-Contract']).toBeUndefined();
        break;
      case 'oversize-body':
        expect((read.body ?? '').length).toBeGreaterThan(262_144);
        break;
      case 'max-age-beyond-bound':
        expect(read.headers?.['Cache-Control']).toBe('max-age=86401');
        break;
    }
  });
});

describe('the handler', () => {
  // Spec 00 §2.3: provider credentials are read once per execution environment.
  it('reads its API key once, however many requests it serves', async () => {
    const handler = handlerFor('provider-a');
    await handler(providerEvent('provider-a', 'GET', '/records/record-0001'));
    await handler(providerEvent('provider-a', 'GET', '/records/record-0002'));
    expect(apiKeyReads).toBe(1);
  });

  it('logs each request by provider, method, status, tenant and correlation, and no body or key', async () => {
    await handlerFor('provider-a')(
      providerEvent('provider-a', 'GET', '/records/record-0001', {
        headers: { 'x-correlation-id': '01JB0000000000000000000009' },
      }),
    );
    expect(loggedRequests).toEqual([
      {
        providerId: 'provider-a',
        method: 'GET',
        status: 200,
        tenantId: 'tenant-1',
        correlationId: '01JB0000000000000000000009',
      },
    ]);
  });
});
