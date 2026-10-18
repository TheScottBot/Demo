// Spec 03 §6.5 and WE4: HttpWriteAdapter against the Spec 00 msw doubles, and
// against a stub transport for the answers no double gives.
import { contractBounds, type CommandRequest, type ProviderIdentifier } from '@demo/contracts';
import {
  computeProviderVersion,
  startProviderDoubles,
  syntheticProviderApiKey,
  syntheticProviderConnections,
  type ProviderDoubles,
} from '@demo/test-doubles';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createHttpWriteAdapter,
  type WriteAdapterMetrics,
} from '../src/adapters/http-write-adapter';

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

const correlationId = '01JB0000000000000000000009';

function baseUrlOf(providerId: ProviderIdentifier): string {
  const connection = syntheticProviderConnections.find(
    (candidate) => candidate.providerId === providerId,
  );
  if (connection === undefined) {
    throw new Error(`no double for ${providerId}`);
  }
  return connection.baseUrl;
}

class RecordingAdapterMetrics implements WriteAdapterMetrics {
  readonly events: unknown[][] = [];
  countRetryAfterIgnored(providerId: ProviderIdentifier): void {
    this.events.push(['ProviderRetryAfterIgnored', providerId]);
  }
}

interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function adapterFor(
  providerId: ProviderIdentifier,
  options: { apiKey?: string; fetchImplementation?: typeof fetch } = {},
) {
  const metrics = new RecordingAdapterMetrics();
  const sent: SentRequest[] = [];
  // Records what the adapter sends, then lets the doubles answer.
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.body === null ? undefined : await request.clone().text(),
    });
    return (options.fetchImplementation ?? fetch)(request);
  };
  let keyReads = 0;
  const adapter = createHttpWriteAdapter({
    providerId,
    baseUrl: baseUrlOf(providerId),
    readApiKey: () => {
      keyReads += 1;
      return Promise.resolve(options.apiKey ?? syntheticProviderApiKey(providerId));
    },
    metrics,
    fetchImplementation: recordingFetch,
  });
  return { adapter, metrics, sent, keyReads: () => keyReads };
}

async function currentVersion(
  providerId: ProviderIdentifier,
  recordId: string,
  tenantId = 'tenant-1',
): Promise<string> {
  const storedRecord = await providerDoubles.store.readRecord({ providerId, tenantId, recordId });
  if (storedRecord === undefined) {
    throw new Error(`no ${recordId} at ${providerId}`);
  }
  return computeProviderVersion(storedRecord.sections);
}

function summaryReplace(recordId: string, baseVersion: string): CommandRequest {
  return {
    type: 'record.section.replace',
    recordId,
    section: 'summary',
    baseVersion,
    payload: { title: 'Synthetic replacement', status: 'closed' },
  };
}

function notesAppend(recordId: string, baseVersion: string): CommandRequest {
  return {
    type: 'record.notes.append',
    recordId,
    section: 'notes',
    baseVersion,
    payload: { text: 'Synthetic appended note' },
  };
}

const idempotencyKey = '00000000-0000-4000-8000-000000000401';

function callOptions(abortSignal = new AbortController().signal) {
  return { abortSignal, correlationId };
}

describe('applied (§6.5)', () => {
  it('replaces a section with PUT, sending If-Match, Idempotency-Key, the key, tenant and correlation', async () => {
    const { adapter, sent } = adapterFor('provider-a');
    const baseVersion = await currentVersion('provider-a', 'record-0001');
    const outcome = await adapter.apply(
      { tenantId: 'tenant-1', command: summaryReplace('record-0001', baseVersion), idempotencyKey },
      callOptions(),
    );
    expect(outcome).toEqual({
      kind: 'applied',
      providerVersion: await currentVersion('provider-a', 'record-0001'),
    });
    expect(outcome).not.toEqual({ kind: 'applied', providerVersion: baseVersion });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      url: `${baseUrlOf('provider-a')}/records/record-0001/sections/summary`,
      headers: {
        'if-match': `"${baseVersion}"`,
        'idempotency-key': idempotencyKey,
        'x-api-key': syntheticProviderApiKey('provider-a'),
        'demo-tenant-id': 'tenant-1',
        'x-correlation-id': correlationId,
        'content-type': 'application/json',
      },
    });
    // §4.4: the body is the section shape itself.
    expect(JSON.parse(String(sent[0]?.body))).toEqual({
      title: 'Synthetic replacement',
      status: 'closed',
    });
  });

  it('appends a note with POST to the entries path, and maps 201 to applied', async () => {
    const { adapter, sent } = adapterFor('provider-b');
    const baseVersion = await currentVersion('provider-b', 'record-0001');
    const outcome = await adapter.apply(
      { tenantId: 'tenant-1', command: notesAppend('record-0001', baseVersion), idempotencyKey },
      callOptions(),
    );
    expect(outcome.kind).toBe('applied');
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: `${baseUrlOf('provider-b')}/records/record-0001/sections/notes/entries`,
    });
    expect(JSON.parse(String(sent[0]?.body))).toEqual({ text: 'Synthetic appended note' });
  });

  it('reads the API key once across calls', async () => {
    const { adapter, keyReads } = adapterFor('provider-a');
    for (const attempt of [1, 2]) {
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', await currentVersion('provider-a', 'record-0001')),
          idempotencyKey: `00000000-0000-4000-8000-00000000040${String(attempt)}`,
        },
        callOptions(),
      );
    }
    expect(keyReads()).toBe(1);
  });
});

describe('conflict (§6.5)', () => {
  it('maps a stale base version, answered 412, to conflict', async () => {
    const { adapter } = adapterFor('provider-a');
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0000000000000000'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'conflict', reason: 'precondition-failed' });
  });

  it('maps the conflict- fault to conflict', async () => {
    const { adapter } = adapterFor('provider-a');
    const outcome = await adapter.apply(
      {
        tenantId: 'tenant-1',
        command: summaryReplace(
          'conflict-0001',
          await currentVersion('provider-a', 'conflict-0001'),
        ),
        idempotencyKey,
      },
      callOptions(),
    );
    expect(outcome.kind).toBe('conflict');
  });

  it.each([
    [
      'a valid ETag gives currentVersion',
      '"fedcba9876543210"',
      { currentVersion: 'fedcba9876543210' },
    ],
    ['an invalid ETag is left out', 'W/"weak"', {}],
    ['no ETag gives none', undefined, {}],
  ])('maps 409 to conflict: %s', async (_caseName, entityTag, expectedVersion) => {
    const { adapter } = adapterFor('provider-a', {
      fetchImplementation: () =>
        Promise.resolve(
          new Response(null, {
            status: 409,
            headers: entityTag === undefined ? {} : { ETag: entityTag },
          }),
        ),
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'conflict', reason: 'provider-conflict', ...expectedVersion });
  });
});

describe('rejected (§6.5)', () => {
  it('maps a record the provider does not hold, answered 404, to rejected', async () => {
    const { adapter } = adapterFor('provider-a');
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-9999', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'rejected', code: 'provider-not-held', reason: 'not-held' });
  });

  it('maps a request the provider finds invalid, answered 400, to rejected', async () => {
    const { adapter } = adapterFor('provider-a');
    const invalidCommand = {
      ...summaryReplace('record-0001', await currentVersion('provider-a', 'record-0001')),
      payload: { title: '', status: 'closed' },
    } as CommandRequest;
    expect(
      await adapter.apply(
        { tenantId: 'tenant-1', command: invalidCommand, idempotencyKey },
        callOptions(),
      ),
    ).toEqual({ kind: 'rejected', code: 'provider-request-invalid', reason: 'request-invalid' });
  });

  it('maps the same key with another body, answered 422, to rejected', async () => {
    const { adapter } = adapterFor('provider-a');
    const baseVersion = await currentVersion('provider-a', 'record-0001');
    await adapter.apply(
      { tenantId: 'tenant-1', command: summaryReplace('record-0001', baseVersion), idempotencyKey },
      callOptions(),
    );
    const otherBody = {
      ...summaryReplace('record-0001', baseVersion),
      payload: { title: 'Another body', status: 'paused' },
    } as CommandRequest;
    expect(
      await adapter.apply(
        { tenantId: 'tenant-1', command: otherBody, idempotencyKey },
        callOptions(),
      ),
    ).toEqual({
      kind: 'rejected',
      code: 'provider-idempotency-key-reused',
      reason: 'idempotency-key-reused',
    });
  });
});

describe('retryable (§6.5, WQ3)', () => {
  it('maps the poison- fault, answered 500, to retryable', async () => {
    const { adapter } = adapterFor('provider-a');
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('poison-0001', await currentVersion('provider-a', 'poison-0001')),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'server-error' });
  });

  it('maps the throttle- fault to retryable with its Retry-After, then applies on the next attempt', async () => {
    const { adapter } = adapterFor('provider-a');
    const command = summaryReplace(
      'throttle-0001',
      await currentVersion('provider-a', 'throttle-0001'),
    );
    expect(
      await adapter.apply({ tenantId: 'tenant-1', command, idempotencyKey }, callOptions()),
    ).toEqual({
      kind: 'retryable',
      reason: 'throttled',
      retryAfterMilliseconds: 2_000,
    });
    expect(
      (await adapter.apply({ tenantId: 'tenant-1', command, idempotencyKey }, callOptions())).kind,
    ).toBe('applied');
  });

  it('maps the flaky- fault, answered 503 twice, to retryable, then applies', async () => {
    const { adapter } = adapterFor('provider-a');
    const command = summaryReplace('flaky-0001', await currentVersion('provider-a', 'flaky-0001'));
    const kinds: string[] = [];
    // Three attempts with one key: the fault fails the first two (CU11).
    while (kinds.length < 3) {
      kinds.push(
        (await adapter.apply({ tenantId: 'tenant-1', command, idempotencyKey }, callOptions()))
          .kind,
      );
    }
    expect(kinds).toEqual(['retryable', 'retryable', 'applied']);
  });

  it('maps the down- fault, answered 503, to retryable', async () => {
    const { adapter } = adapterFor('provider-a');
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('down-a-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'unavailable' });
  });

  it('maps a refused API key, answered 401, to retryable, so a person can fix and redrive it', async () => {
    const { adapter } = adapterFor('provider-a', { apiKey: 'synthetic-wrong-key' });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'api-key-refused' });
  });

  it.each([
    [428, 'if-match-required'],
    [418, 'unexpected-status'],
    [204, 'unexpected-status'],
    [302, 'unexpected-status'],
  ])('maps %i, which §6.5 does not list, to retryable %s (WQ3)', async (status, reason) => {
    const { adapter } = adapterFor('provider-a', {
      fetchImplementation: () => Promise.resolve(new Response(null, { status })),
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason });
  });

  it('ignores and counts a Retry-After beyond the bound, keeping the outcome retryable', async () => {
    const { adapter, metrics } = adapterFor('provider-a', {
      fetchImplementation: () =>
        Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': String(contractBounds.providerRetryAfterMaximumSeconds + 1) },
          }),
        ),
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'throttled' });
    expect(metrics.events).toEqual([['ProviderRetryAfterIgnored', 'provider-a']]);
  });

  it('maps a failed read of the API key to retryable, kept apart from transport, and sends nothing', async () => {
    const sent: unknown[] = [];
    const adapter = createHttpWriteAdapter({
      providerId: 'provider-a',
      baseUrl: baseUrlOf('provider-a'),
      readApiKey: () => Promise.reject(new Error('ResourceNotFoundException')),
      metrics: new RecordingAdapterMetrics(),
      fetchImplementation: (input) => {
        sent.push(input);
        return Promise.reject(new Error('not reached'));
      },
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'api-key-unavailable' });
    expect(sent).toEqual([]);
  });

  it('maps a network failure to retryable transport', async () => {
    const { adapter } = adapterFor('provider-a', {
      fetchImplementation: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'transport' });
  });

  it('maps an abort to retryable, never throwing, whether before the call or as the body arrives', async () => {
    const abortedBefore = new AbortController();
    abortedBefore.abort(new DOMException('deadline', 'TimeoutError'));
    const { adapter } = adapterFor('provider-a');
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(abortedBefore.signal),
      ),
    ).toEqual({ kind: 'retryable', reason: 'aborted' });
    const abortedDuring = new AbortController();
    const { adapter: stalledAdapter } = adapterFor('provider-a', {
      fetchImplementation: () => {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            abortedDuring.signal.addEventListener('abort', () => {
              controller.error(abortedDuring.signal.reason);
            });
            abortedDuring.abort(new DOMException('deadline', 'TimeoutError'));
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
          }),
        );
      },
    });
    expect(
      await stalledAdapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(abortedDuring.signal),
      ),
    ).toEqual({ kind: 'retryable', reason: 'aborted' });
  });
});

describe('a 2xx the adapter cannot trust (§6.5, Spec 00 §4.1)', () => {
  it('stops reading an oversized body at the bound, rather than reading it all (datum 0.10)', async () => {
    const chunkBytes = 65_536;
    let pulledBytes = 0;
    const { adapter } = adapterFor('provider-a', {
      fetchImplementation: () => {
        // Ten times the bound on offer, one chunk at a time, with no length declared.
        const body = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (pulledBytes >= contractBounds.providerResponseBodyMaximumBytes * 10) {
              controller.close();
              return;
            }
            pulledBytes += chunkBytes;
            controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
          }),
        );
      },
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason: 'body-too-large' });
    // The chunk that crosses the bound, and whatever the stream had queued.
    expect(pulledBytes).toBeLessThanOrEqual(
      contractBounds.providerResponseBodyMaximumBytes + 2 * chunkBytes,
    );
  });

  const validBody = JSON.stringify({
    recordId: 'record-0001',
    section: 'summary',
    updatedAt: '2026-10-18T09:30:00.000Z',
  });

  it.each([
    ['a missing contract version', { ETag: '"fedcba9876543210"' }, validBody, 'version-mismatch'],
    [
      'another contract version',
      { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '2' },
      validBody,
      'version-mismatch',
    ],
    ['a missing ETag', { 'Demo-Provider-Contract': '1' }, validBody, 'header-invalid'],
    [
      'a weak ETag',
      { ETag: 'W/"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
      validBody,
      'header-invalid',
    ],
    [
      'a body over the bound',
      { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
      'x'.repeat(contractBounds.providerResponseBodyMaximumBytes + 1),
      'body-too-large',
    ],
    [
      'a body that breaks its schema',
      { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
      '{}',
      'schema-invalid',
    ],
    [
      'a body about another record',
      { ETag: '"fedcba9876543210"', 'Demo-Provider-Contract': '1' },
      JSON.stringify({
        recordId: 'record-0002',
        section: 'summary',
        updatedAt: '2026-10-18T09:30:00.000Z',
      }),
      'schema-invalid',
    ],
  ])('maps %s to retryable, by reason category', async (_caseName, headers, body, reason) => {
    const { adapter } = adapterFor('provider-a', {
      fetchImplementation: () => Promise.resolve(new Response(body, { status: 200, headers })),
    });
    expect(
      await adapter.apply(
        {
          tenantId: 'tenant-1',
          command: summaryReplace('record-0001', '0123456789abcdef'),
          idempotencyKey,
        },
        callOptions(),
      ),
    ).toEqual({ kind: 'retryable', reason });
  });
});
