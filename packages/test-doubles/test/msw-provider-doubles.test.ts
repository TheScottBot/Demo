import {
  ProviderReadResponseBodySchema,
  ProviderWriteResponseBodySchema,
  contractBounds,
  isProviderContractVersionSupported,
  mockProviderBehaviour,
  mockProviderFaults,
  parseCacheControlMaxAge,
  parseEntityTag,
  sectionsOwnedByProvider,
  type ProviderIdentifier,
  type SectionName,
} from '@demo/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  startProviderDoubles,
  syntheticCommandFor,
  syntheticProviderConnections,
  syntheticRecords,
  type ProviderDoubles,
} from '../src/index';

const idempotencyKey = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

let providerDoubles: ProviderDoubles;

beforeAll(() => {
  providerDoubles = startProviderDoubles();
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
    throw new Error(`no connection for ${providerId}`);
  }
  return connection;
}

function providerFetch(
  providerId: ProviderIdentifier,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  tenantId = 'tenant-1',
): Promise<Response> {
  const connection = connectionFor(providerId);
  return fetch(`${connection.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'X-Api-Key': connection.apiKey, 'Demo-Tenant-Id': tenantId, ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

// The section each provider can replace, for write fault checks.
function replaceableSectionOf(providerId: ProviderIdentifier): Exclude<SectionName, 'notes'> {
  for (const sectionName of sectionsOwnedByProvider(providerId)) {
    if (sectionName !== 'notes') {
      return sectionName;
    }
  }
  throw new Error(`no replaceable section on ${providerId}`);
}

async function replaceOn(providerId: ProviderIdentifier, recordId: string): Promise<Response> {
  const section = replaceableSectionOf(providerId);
  const readResponse = await providerFetch(providerId, `/records/${recordId}`);
  const entityTag = readResponse.headers.get('ETag') ?? '"0000000000000000"';
  return providerFetch(providerId, `/records/${recordId}/sections/${section}`, {
    method: 'PUT',
    headers: { 'If-Match': entityTag, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(syntheticCommandFor(section, recordId, 'unused').payload),
  });
}

const readFaultChecks: Record<string, (response: Response) => Promise<void>> = {
  'service-unavailable': (response) => {
    expect(response.status).toBe(503);
    return Promise.resolve();
  },
  'omit-contract-header': (response) => {
    expect(response.status).toBe(200);
    expect(response.headers.get('Demo-Provider-Contract')).toBeNull();
    return Promise.resolve();
  },
  'oversize-body': async (response) => {
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(
      contractBounds.providerResponseBodyMaximumBytes,
    );
  },
  'max-age-beyond-bound': (response) => {
    expect(response.status).toBe(200);
    expect(parseCacheControlMaxAge(response.headers.get('Cache-Control') ?? undefined)).toEqual({
      outcome: 'invalid',
    });
    return Promise.resolve();
  },
};

describe('every fault prefix through the msw doubles', () => {
  const faultCases = mockProviderFaults.flatMap((fault) =>
    fault.providers.map((providerId) => [fault.prefix, providerId, fault] as const),
  );

  it.each(faultCases.filter(([, , fault]) => fault.effect in readFaultChecks))(
    '%s on %s, read',
    async (prefix, providerId, fault) => {
      const check = readFaultChecks[fault.effect];
      if (check === undefined) {
        throw new Error('unreachable');
      }
      await check(await providerFetch(providerId, `/records/${prefix}0001`));
    },
  );

  it.each(
    faultCases.filter(
      ([, , fault]) => fault.appliesTo !== 'reads' && fault.effect !== 'delay-response',
    ),
  )('%s on %s, write', async (prefix, providerId, fault) => {
    const recordId = `${prefix}0001`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await replaceOn(providerId, recordId)).status);
    }
    const expectedStatuses: Record<string, number[]> = {
      'service-unavailable': [503, 503, 503],
      'unavailable-for-first-attempts': [503, 503, 200],
      'throttle-once-per-key': [429, 200, 200],
      'server-error': [500, 500, 500],
      'precondition-failed': [412, 412, 412],
    };
    expect(statuses).toEqual(expectedStatuses[fault.effect]);
  });

  it('throttle- sends the CU11 Retry-After', async () => {
    const response = await replaceOn('provider-b', 'throttle-0001');
    expect(response.headers.get('Retry-After')).toBe(
      String(mockProviderBehaviour.throttleRetryAfterSeconds),
    );
  });

  it('slow-a-, slow-b- and slow-c- each delay only their own provider by CU9', async () => {
    const startedAt = performance.now();
    const slowResponses = await Promise.all(
      (['provider-a', 'provider-b', 'provider-c'] as const).map((providerId) =>
        providerFetch(providerId, `/records/slow-${providerId.slice(-1)}-0001`),
      ),
    );
    const elapsedMilliseconds = performance.now() - startedAt;
    expect(slowResponses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(
      mockProviderBehaviour.slowResponseDelayMilliseconds - 50,
    );
    const unaffectedStartedAt = performance.now();
    await providerFetch('provider-b', '/records/slow-a-0001');
    expect(performance.now() - unaffectedStartedAt).toBeLessThan(1_000);
  }, 10_000);
});

describe('ordinary double responses', () => {
  const faultPrefixesThatBreakTheSchema = ['down-', 'oldversion-', 'oversize-', 'badheader-'];
  const ordinaryCases = syntheticRecords
    .filter(
      (syntheticRecord) =>
        !faultPrefixesThatBreakTheSchema.some((prefix) =>
          syntheticRecord.recordId.startsWith(prefix),
        ) && !syntheticRecord.recordId.startsWith('slow-'),
    )
    .flatMap((syntheticRecord) =>
      syntheticProviderConnections.map(
        (connection) =>
          [syntheticRecord.tenantId, syntheticRecord.recordId, connection.providerId] as const,
      ),
    );

  it.each(ordinaryCases)(
    '%s %s on %s passes the Spec 00 §4.4 read schemas',
    async (tenantId, recordId, providerId) => {
      const response = await providerFetch(providerId, `/records/${recordId}`, {}, tenantId);
      if (response.status === 404) {
        const ownsAnySection = sectionsOwnedByProvider(providerId).some(
          (sectionName) =>
            syntheticRecords.find(
              (syntheticRecord) =>
                syntheticRecord.tenantId === tenantId && syntheticRecord.recordId === recordId,
            )?.sections[sectionName] !== undefined,
        );
        expect(ownsAnySection).toBe(false);
        return;
      }
      expect(response.status).toBe(200);
      expect(ProviderReadResponseBodySchema.safeParse(await response.json()).success).toBe(true);
      expect(parseEntityTag(response.headers.get('ETag') ?? undefined).outcome).toBe('valid');
      expect(
        parseCacheControlMaxAge(response.headers.get('Cache-Control') ?? undefined).outcome,
      ).toBe('valid');
      expect(
        isProviderContractVersionSupported(
          response.headers.get('Demo-Provider-Contract') ?? undefined,
        ),
      ).toBe(true);
    },
  );

  it.each(syntheticProviderConnections.map((connection) => [connection.providerId] as const))(
    'a successful write on %s passes the Spec 00 §4.4 write schema',
    async (providerId) => {
      const response = await replaceOn(providerId, 'record-0001');
      expect(response.status).toBe(200);
      expect(ProviderWriteResponseBodySchema.safeParse(await response.json()).success).toBe(true);
      expect(parseEntityTag(response.headers.get('ETag') ?? undefined).outcome).toBe('valid');
      expect(
        isProviderContractVersionSupported(
          response.headers.get('Demo-Provider-Contract') ?? undefined,
        ),
      ).toBe(true);
    },
  );

  it('start each test from the seed', async () => {
    const before = await providerFetch('provider-a', '/records/record-0002');
    await replaceOn('provider-a', 'record-0002');
    providerDoubles.reset();
    const after = await providerFetch('provider-a', '/records/record-0002');
    expect(after.headers.get('ETag')).toBe(before.headers.get('ETag'));
  });
});

// CU6: msw 3 renamed the option that refuses unmatched requests, and the old
// name is silently ignored, so this proves the doubles really refuse one.
describe('unmatched requests', () => {
  it('are refused by msw itself rather than sent to the network', async () => {
    // Asserting only that fetch rejects is not enough: an unmatched request
    // that escapes to the network also rejects here, because the host does not
    // resolve. The refusal must be msw's own.
    const refusal: unknown = await fetch('https://unmatched.example.test/records/record-0001').then(
      () => undefined,
      (fetchError: unknown) => fetchError,
    );
    expect(refusal).toBeInstanceOf(Error);
    const refusalCause = (refusal as Error).cause;
    const refusalText = `${(refusal as Error).message} ${refusalCause instanceof Error ? refusalCause.message : ''}`;
    expect(refusalText).toContain('[MSW]');
  });
});
