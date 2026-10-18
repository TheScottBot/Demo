// Spec 02 §2 to §5 and RE4: the read handler, invoked directly with the
// shared event builder (CE2) against the msw doubles, and against stub
// adapters for the rows no double can produce.
import {
  ProblemDocumentSchema,
  ReadResponseSchema,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
  type ProviderIdentifier,
  type ProviderReadResult,
  type ReadAdapter,
} from '@demo/contracts';
import {
  buildLambdaContext,
  buildVerifiedClaimsEvent,
  publicRouteNamed,
  startProviderDoubles,
  syntheticProviderConnections,
  syntheticRecords,
  createInMemoryProviderStore,
  type ProviderDoubles,
} from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createHttpReadAdapter,
  createReadHandler,
  disabledReadCachePolicy,
  formatAggregateEntityTag,
  parseAggregateEntityTag,
  readPathSettings,
  type ProviderCallOutcome,
  type ReadPathLog,
  type ReadPathMetrics,
} from '../src/index';

// The seed without tenant-2's record-0003, so a tenant-2 read of it finds
// nothing anywhere, while tenant-1's copy exists.
const seedWithoutOneTenantTwoRecord = syntheticRecords.filter(
  (syntheticRecord) =>
    !(syntheticRecord.tenantId === 'tenant-2' && syntheticRecord.recordId === 'record-0003'),
);

let providerDoubles: ProviderDoubles;

beforeAll(() => {
  providerDoubles = startProviderDoubles({
    store: createInMemoryProviderStore(seedWithoutOneTenantTwoRecord),
  });
});

afterEach(() => {
  providerDoubles.reset();
});

afterAll(() => {
  providerDoubles.stop();
});

class RecordingReadPath
  implements ReadPathLog, ReadPathMetrics, ProblemHandlingLog, ProblemHandlingMetrics
{
  readonly events: unknown[][] = [];
  bindTenant(tenantId: string): void {
    this.events.push(['bindTenant', tenantId]);
  }
  recordAbsentSubsystem(subsystem: string, reason: string): void {
    this.events.push(['absent', subsystem, reason]);
  }
  recordConditionalRefetch(providerIds: readonly ProviderIdentifier[]): void {
    this.events.push(['refetchLog', [...providerIds]]);
  }
  recordProviderCall(outcome: ProviderCallOutcome): void {
    this.events.push([
      'providerCall',
      outcome.providerId,
      outcome.status,
      outcome.errorReason ?? null,
    ]);
  }
  countSectionsIgnored(providerId: ProviderIdentifier, sectionCount: number): void {
    this.events.push(['sectionsIgnored', providerId, sectionCount]);
  }
  countReadPartial(): void {
    this.events.push(['ReadPartial']);
  }
  countReadNotModified(): void {
    this.events.push(['ReadNotModified']);
  }
  countReadAllSourcesUnavailable(): void {
    this.events.push(['ReadAllSourcesUnavailable']);
  }
  countConditionalRefetch(providerId: ProviderIdentifier): void {
    this.events.push(['ConditionalRefetch', providerId]);
  }
  bindRequestKeys(): void {}
  clearRequestKeys(): void {}
  recordRejection(rejection: { errorCode: string }): void {
    this.events.push(['rejection', rejection.errorCode]);
  }
  recordInternalFailure(failure: { errorName: string }): void {
    this.events.push(['internalFailure', failure.errorName]);
  }
  countRequestRejected(): void {}
  named(eventName: string): unknown[][] {
    return this.events.filter((recordedEvent) => recordedEvent[0] === eventName);
  }
}

function doubleAdapters(): ReadAdapter[] {
  return syntheticProviderConnections.map((connection) =>
    createHttpReadAdapter({
      providerId: connection.providerId,
      baseUrl: connection.baseUrl,
      readApiKey: () => Promise.resolve(connection.apiKey),
    }),
  );
}

function handlerWith(
  options: {
    readAdapters?: ReadAdapter[];
    providerTimeoutMilliseconds?: number;
    fanOutBudgetMilliseconds?: number;
  } = {},
) {
  const recorder = new RecordingReadPath();
  const readHandler = createReadHandler({
    readAdapters: options.readAdapters ?? doubleAdapters(),
    problemLog: recorder,
    problemMetrics: recorder,
    readLog: recorder,
    readMetrics: recorder,
    readCachePolicy: disabledReadCachePolicy,
    timing: {
      providerTimeoutMilliseconds: options.providerTimeoutMilliseconds ?? 300,
      fanOutBudgetMilliseconds: options.fanOutBudgetMilliseconds ?? 600,
    },
    now: () => new Date('2026-10-18T12:00:00.000Z'),
    monotonicNow: () => performance.now(),
  });
  return { readHandler, recorder };
}

function readEvent(
  recordId: string,
  options: { ifNoneMatch?: string; tenantId?: string; scope?: string } = {},
) {
  return buildVerifiedClaimsEvent({
    route: publicRouteNamed('read-record'),
    pathParameters: { recordId },
    headers: [
      ['X-Correlation-Id', '01JB0000000000000000000009'],
      ...(options.ifNoneMatch === undefined
        ? []
        : ([['If-None-Match', options.ifNoneMatch]] as [string, string][])),
    ],
    claims: { tenantId: options.tenantId ?? 'tenant-1', scope: options.scope ?? 'records:read' },
  });
}

async function read(
  recordId: string,
  options: { ifNoneMatch?: string; tenantId?: string; scope?: string } = {},
  handler = handlerWith(),
): Promise<APIGatewayProxyStructuredResultV2> {
  return handler.readHandler(readEvent(recordId, options), buildLambdaContext());
}

function bodyOf(response: APIGatewayProxyStructuredResultV2) {
  return ReadResponseSchema.parse(JSON.parse(response.body ?? 'null'));
}

function problemOf(response: APIGatewayProxyStructuredResultV2) {
  return ProblemDocumentSchema.parse(JSON.parse(response.body ?? 'null'));
}

function entityTagOf(response: APIGatewayProxyStructuredResultV2): string {
  const entityTag = response.headers?.['ETag'];
  if (typeof entityTag !== 'string') {
    throw new Error('expected an ETag');
  }
  return entityTag;
}

describe('§2 request checks', () => {
  it('refuses a token without records:read with 403', async () => {
    const response = await read('record-0001', { scope: 'records:write' });
    expect(response.statusCode).toBe(403);
  });

  it.each([
    ['a recordId of 129 characters', 'r'.repeat(129)],
    ['a recordId outside the grammar', 'record.0001'],
  ])('refuses %s with 400', async (_caseName, recordId) => {
    const response = await read(recordId);
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).invalidFields).toEqual([
      { path: 'pathParameters.recordId', reason: expect.any(String) as string },
    ]);
  });

  it.each([
    ['over the 1,024 character bound', `"v1.${'A'.repeat(1_024)}"`],
    ['a weak validator', 'W/"v1.eyJwcm92aWRlci1hIjoiYTEifQ"'],
    ['a list', '"v1.eyJwcm92aWRlci1hIjoiYTEifQ", "v1.eyJwcm92aWRlci1hIjoiYTEifQ"'],
    ['the wildcard', '*'],
    [
      'a provider outside the routing table',
      `"v1.${Buffer.from('{"provider-z":"z1"}').toString('base64url')}"`,
    ],
  ])(
    'refuses an If-None-Match %s with 400, before calling any provider',
    async (_caseName, ifNoneMatch) => {
      const handler = handlerWith();
      const response = await handler.readHandler(
        readEvent('record-0001', { ifNoneMatch }),
        buildLambdaContext(),
      );
      expect(response.statusCode).toBe(400);
      expect(problemOf(response).invalidFields).toEqual([
        { path: 'headers.If-None-Match', reason: expect.any(String) as string },
      ]);
      expect(handler.recorder.named('providerCall')).toEqual([]);
    },
  );
});

describe('a complete read (§5)', () => {
  it('answers 200 with every source ok, an ETag, private caching and Vary', async () => {
    const handler = handlerWith();
    const response = await read('record-0001', {}, handler);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response);
    expect(body.partial).toBe(false);
    expect(body.servedFrom).toBe('live');
    expect(body.sources.map((source) => source.status)).toEqual(['ok', 'ok', 'ok']);
    expect(Object.keys(body.record.sections).sort()).toEqual([
      'notes',
      'preferences',
      'schedule',
      'summary',
      'tasks',
    ]);
    expect(parseAggregateEntityTag(entityTagOf(response)).outcome).toBe('valid');
    expect(response.headers?.['Cache-Control']).toBe('private, max-age=60');
    expect(response.headers?.['Vary']).toBe('Authorization');
    expect(response.headers?.['X-Correlation-Id']).toBe('01JB0000000000000000000009');
    expect(response.headers?.['Content-Type']).toBe('application/json');
    expect(handler.recorder.named('providerCall')).toHaveLength(3);
    expect(handler.recorder.named('bindTenant')).toEqual([['bindTenant', 'tenant-1']]);
  });

  it('takes max-age from the smallest provider ttl', async () => {
    const stub = (providerId: ProviderIdentifier, ttlSeconds: number): ReadAdapter => ({
      providerId,
      read: () =>
        Promise.resolve({
          outcome: 'ok',
          version: `${providerId}-v`,
          updatedAt: '2026-10-18T09:00:00.000Z',
          ttlSeconds,
          sections: {},
        } satisfies ProviderReadResult),
    });
    const response = await read(
      'record-0001',
      {},
      handlerWith({
        readAdapters: [stub('provider-a', 120), stub('provider-b', 45), stub('provider-c', 300)],
      }),
    );
    expect(response.headers?.['Cache-Control']).toBe('private, max-age=45');
  });
});

describe('§4.3 conditional requests', () => {
  it('answers 304 with the same ETag and no body when every provider is unchanged', async () => {
    const entityTag = entityTagOf(await read('record-0001'));
    const handler = handlerWith();
    const response = await read('record-0001', { ifNoneMatch: entityTag }, handler);
    expect(response.statusCode).toBe(304);
    expect(response.body).toBeUndefined();
    expect(entityTagOf(response)).toBe(entityTag);
    expect(response.headers?.['Cache-Control']).toBe('private, max-age=60');
    expect(response.headers?.['Vary']).toBe('Authorization');
    expect(handler.recorder.named('ReadNotModified')).toHaveLength(1);
  });

  it('calls the unchanged providers again for their bodies when another has changed, and answers 200', async () => {
    const current = parseAggregateEntityTag(entityTagOf(await read('record-0001')));
    if (current.outcome !== 'valid') {
      throw new Error('expected a valid ETag');
    }
    const staleForProviderA = formatAggregateEntityTag({
      ...current.versionsByProvider,
      'provider-a': 'stale-version',
    });
    const handler = handlerWith();
    const response = await read('record-0001', { ifNoneMatch: staleForProviderA }, handler);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response);
    expect(body.partial).toBe(false);
    expect(Object.keys(body.record.sections)).toHaveLength(5);
    expect(entityTagOf(response)).not.toBe(staleForProviderA);
    expect(handler.recorder.named('ConditionalRefetch')).toEqual([
      ['ConditionalRefetch', 'provider-b'],
      ['ConditionalRefetch', 'provider-c'],
    ]);
    expect(handler.recorder.named('refetchLog')).toEqual([
      ['refetchLog', ['provider-b', 'provider-c']],
    ]);
  });

  it('answers 200, partial and without an ETag, when that second call fails', async () => {
    let callsToB = 0;
    const realAdapters = doubleAdapters();
    const failsSecondTime: ReadAdapter = {
      providerId: 'provider-b',
      read: (readRequest, callOptions) => {
        callsToB += 1;
        return callsToB === 1
          ? (realAdapters[1] as ReadAdapter).read(readRequest, callOptions)
          : Promise.resolve({ outcome: 'error', errorReason: 'http-status', ttlSeconds: 0 });
      },
    };
    const current = parseAggregateEntityTag(entityTagOf(await read('record-0001')));
    if (current.outcome !== 'valid') {
      throw new Error('expected a valid ETag');
    }
    const staleForProviderA = formatAggregateEntityTag({
      ...current.versionsByProvider,
      'provider-a': 'stale-version',
    });
    const response = await read(
      'record-0001',
      { ifNoneMatch: staleForProviderA },
      handlerWith({
        readAdapters: [
          realAdapters[0] as ReadAdapter,
          failsSecondTime,
          realAdapters[2] as ReadAdapter,
        ],
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).partial).toBe(true);
    expect(
      bodyOf(response).sources.find((source) => source.providerId === 'provider-b')?.status,
    ).toBe('error');
    expect(response.headers?.['ETag']).toBeUndefined();
    expect(response.headers?.['Cache-Control']).toBe('private, max-age=0, must-revalidate');
  });

  it('answers 503 when some providers are unchanged and the rest failed, none 200', async () => {
    const notModified = (providerId: ProviderIdentifier): ReadAdapter => ({
      providerId,
      read: () => Promise.resolve({ outcome: 'not-modified', version: 'v1', ttlSeconds: 60 }),
    });
    const failing: ReadAdapter = {
      providerId: 'provider-c',
      read: () => Promise.resolve({ outcome: 'error', errorReason: 'transport', ttlSeconds: 0 }),
    };
    const ifNoneMatch = formatAggregateEntityTag({
      'provider-a': 'v1',
      'provider-b': 'v1',
      'provider-c': 'v1',
    });
    const response = await read(
      'record-0001',
      { ifNoneMatch },
      handlerWith({
        readAdapters: [notModified('provider-a'), notModified('provider-b'), failing],
      }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers?.['Retry-After']).toBe('5');
  });
});

describe('RQ4: a provider holding nothing of the record', () => {
  it('still gives the record an ETag, and a 304 when nothing has changed', async () => {
    const first = await read('record-0006');
    expect(bodyOf(first).sources.find((source) => source.providerId === 'provider-c')?.status).toBe(
      'not-found',
    );
    const entityTag = entityTagOf(first);
    const parsed = parseAggregateEntityTag(entityTag);
    expect(parsed.outcome === 'valid' && Object.keys(parsed.versionsByProvider)).toEqual([
      'provider-a',
      'provider-b',
    ]);
    expect((await read('record-0006', { ifNoneMatch: entityTag })).statusCode).toBe(304);
  });

  // The safeguard: a provider in the client's ETag that now holds nothing
  // must not let a 304 keep its sections alive in the client's copy.
  it('answers 200 when a provider in the client ETag now answers not-found', async () => {
    const current = parseAggregateEntityTag(entityTagOf(await read('record-0006')));
    if (current.outcome !== 'valid') {
      throw new Error('expected a valid ETag');
    }
    const withProviderC = formatAggregateEntityTag({
      ...current.versionsByProvider,
      'provider-c': 'once-held',
    });
    const handler = handlerWith();
    const response = await read('record-0006', { ifNoneMatch: withProviderC }, handler);
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).record.sections.preferences).toBeUndefined();
    expect(entityTagOf(response)).not.toBe(withProviderC);
    expect(handler.recorder.named('ConditionalRefetch')).toHaveLength(2);
  });
});

describe('§3.4 partial and total failure', () => {
  it('answers 200, partial, with the slow provider timed out, no ETag and max-age 0 (slow-b-)', async () => {
    const handler = handlerWith();
    const response = await read('slow-b-0001', {}, handler);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response);
    expect(body.partial).toBe(true);
    expect(body.sources.map((source) => source.status)).toEqual(['ok', 'timeout', 'ok']);
    expect(response.headers?.['ETag']).toBeUndefined();
    expect(response.headers?.['Cache-Control']).toBe('private, max-age=0, must-revalidate');
    expect(response.headers?.['Vary']).toBe('Authorization');
    expect(handler.recorder.named('ReadPartial')).toHaveLength(1);
  });

  it('answers 200, partial, with the failed provider as error (down-a-)', async () => {
    const response = await read('down-a-0001');
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).sources[0]).toMatchObject({
      providerId: 'provider-a',
      status: 'error',
      errorReason: 'http-status',
    });
  });

  it('answers 503 with Retry-After when no provider answered', async () => {
    const failing = (providerId: ProviderIdentifier): ReadAdapter => ({
      providerId,
      read: () => Promise.resolve({ outcome: 'error', errorReason: 'transport', ttlSeconds: 0 }),
    });
    const handler = handlerWith({
      readAdapters: [failing('provider-a'), failing('provider-b'), failing('provider-c')],
    });
    const response = await read('record-0001', {}, handler);
    expect(response.statusCode).toBe(503);
    expect(problemOf(response).type).toBe('https://errors.demo.local/all-sources-unavailable');
    expect(response.headers?.['Retry-After']).toBe(String(readPathSettings.retryAfterSeconds));
    expect(handler.recorder.named('ReadAllSourcesUnavailable')).toHaveLength(1);
  });

  it('answers 404 when every provider holds nothing of the record', async () => {
    const response = await read('record-9999');
    expect(response.statusCode).toBe(404);
    expect(problemOf(response).type).toBe('https://errors.demo.local/not-found');
  });

  it("answers 404 for another tenant's record", async () => {
    expect((await read('record-0003', { tenantId: 'tenant-1' })).statusCode).toBe(200);
    expect((await read('record-0003', { tenantId: 'tenant-2' })).statusCode).toBe(404);
  });
});

describe('observability (§8)', () => {
  it('records each provider call, and counts sections a provider sent but does not own', async () => {
    const overreaching: ReadAdapter = {
      providerId: 'provider-a',
      read: () =>
        Promise.resolve({
          outcome: 'ok',
          version: 'a1',
          updatedAt: '2026-10-18T09:00:00.000Z',
          ttlSeconds: 60,
          sections: {
            summary: { title: 'Synthetic title', status: 'active' },
            preferences: { contactWindow: 'evening', language: 'en-GB' },
          },
        }),
    };
    const realAdapters = doubleAdapters();
    const handler = handlerWith({
      readAdapters: [overreaching, realAdapters[1] as ReadAdapter, realAdapters[2] as ReadAdapter],
    });
    await read('record-0001', {}, handler);
    expect(handler.recorder.named('providerCall')).toEqual([
      ['providerCall', 'provider-a', 'ok', null],
      ['providerCall', 'provider-b', 'ok', null],
      ['providerCall', 'provider-c', 'ok', null],
    ]);
    expect(handler.recorder.named('sectionsIgnored')).toEqual([
      ['sectionsIgnored', 'provider-a', 1],
    ]);
  });

  it('logs the absent read cache once, when the handler is created (cold start)', () => {
    const { recorder } = handlerWith();
    expect(recorder.named('absent')).toEqual([
      ['absent', 'read-cache', expect.any(String) as string],
    ]);
  });

  it('holds RU7 as the author adopted it', () => {
    expect(readPathSettings.retryAfterSeconds).toBe(5);
  });
});
