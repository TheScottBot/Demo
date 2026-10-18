// Spec 03 WE9 under WQ1 and CQ6: nothing is deployed, so the write path runs
// locally: the real intake, relay, sweep, worker and status handlers, joined
// by the fake journal table and its stream and an in-memory FIFO queue, with
// the worker's real adapters calling the mock providers as local servers over
// HTTP. Results are read from the mock providers' own store, which is the
// double (Spec 00 §5.4).
import { OperationStatusSchema, type ProviderIdentifier } from '@demo/contracts';
import { startLocalMockProviders, type LocalMockProviders } from '@demo/mock-providers';
import { computeProviderVersion } from '@demo/test-doubles';
import {
  createLocalWritePath,
  type LocalWritePath,
} from '@demo/write/test-support/local-write-path';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let localProviders: LocalMockProviders;
let writePath: LocalWritePath;

beforeAll(async () => {
  // Port 0: the operating system picks free ports, so runs never collide.
  localProviders = await startLocalMockProviders({
    ports: { 'provider-a': 0, 'provider-b': 0, 'provider-c': 0 },
  });
});

afterEach(() => {
  writePath.stop();
  localProviders.store.reset();
});

afterAll(async () => {
  await localProviders.stop();
});

function startWritePath(relayEnabled = true): LocalWritePath {
  writePath = createLocalWritePath({
    relayEnabled,
    providerConnections: localProviders.connections,
  });
  return writePath;
}

async function providerSections(
  providerId: ProviderIdentifier,
  recordId: string,
  tenantId = 'tenant-1',
) {
  const storedRecord = await localProviders.store.readRecord({ providerId, tenantId, recordId });
  if (storedRecord === undefined) {
    throw new Error(`no ${recordId} at ${providerId}`);
  }
  return storedRecord.sections;
}

async function versionOf(providerId: ProviderIdentifier, recordId: string): Promise<string> {
  return computeProviderVersion(await providerSections(providerId, recordId));
}

async function summaryReplace(recordId: string, title = 'Synthetic WE9 summary') {
  return {
    type: 'record.section.replace',
    recordId,
    section: 'summary',
    baseVersion: await versionOf('provider-a', recordId),
    payload: { title, status: 'paused' },
  };
}

function accepted(response: APIGatewayProxyStructuredResultV2) {
  expect(response.statusCode).toBe(202);
  return OperationStatusSchema.parse(JSON.parse(response.body ?? 'null'));
}

async function finalStatus(operationId: string) {
  const response = await writePath.status(operationId);
  expect(response.statusCode).toBe(200);
  return OperationStatusSchema.parse(JSON.parse(response.body ?? 'null'));
}

function callsFor(operationId: string) {
  return writePath.providerCalls.filter((call) => call.operationId === operationId);
}

describe('the write path against the local mock providers (WE9)', () => {
  it('replaces a section: SUCCEEDED, and the mock provider holds the new section', async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('record-0001')));
    await writePath.settle();
    expect(await finalStatus(operationId)).toMatchObject({ state: 'SUCCEEDED', attempts: 1 });
    expect((await providerSections('provider-a', 'record-0001')).summary).toEqual({
      title: 'Synthetic WE9 summary',
      status: 'paused',
    });
  });

  it('appends a note: SUCCEEDED, and the mock provider holds the note', async () => {
    startWritePath();
    const { operationId } = accepted(
      await writePath.submit({
        type: 'record.notes.append',
        recordId: 'record-0001',
        section: 'notes',
        baseVersion: await versionOf('provider-b', 'record-0001'),
        payload: { text: 'Synthetic WE9 note' },
      }),
    );
    await writePath.settle();
    expect((await finalStatus(operationId)).state).toBe('SUCCEEDED');
    expect(
      (await providerSections('provider-b', 'record-0001')).notes?.entries.map(
        (entry) => entry.text,
      ),
    ).toContain('Synthetic WE9 note');
  });

  it('takes the same key and body twice as one operation, applied once, the second answer replayed', async () => {
    startWritePath();
    const command = await summaryReplace('record-0001');
    const first = accepted(await writePath.submit(command));
    await writePath.settle();
    const replayResponse = await writePath.submit(command);
    expect(replayResponse.headers?.['Idempotent-Replayed']).toBe('true');
    expect(accepted(replayResponse).operationId).toBe(first.operationId);
    await writePath.settle();
    expect(callsFor(first.operationId)).toHaveLength(1);
  });

  it('answers the same key with a different body 422 at intake', async () => {
    startWritePath();
    accepted(await writePath.submit(await summaryReplace('record-0001')));
    const reused = await writePath.submit(
      await summaryReplace('record-0001', 'Another WE9 summary'),
    );
    expect(reused.statusCode).toBe(422);
  });

  it('ends a stale base version CONFLICT, with attempts of 1', async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('conflict-0001')));
    await writePath.settle();
    expect(await finalStatus(operationId)).toMatchObject({ state: 'CONFLICT', attempts: 1 });
  });

  it('rides out transient failures: SUCCEEDED with attempts of 3', async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('flaky-0001')));
    await writePath.settle();
    expect(await finalStatus(operationId)).toMatchObject({ state: 'SUCCEEDED', attempts: 3 });
  });

  it('waits out a throttle: SUCCEEDED, the second attempt at least the Retry-After after the first', async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('throttle-0001')));
    await writePath.settle();
    expect((await finalStatus(operationId)).state).toBe('SUCCEEDED');
    const [firstCall, secondCall] = callsFor(operationId);
    expect(callsFor(operationId)).toHaveLength(2);
    expect((secondCall?.at ?? 0) - (firstCall?.at ?? 0)).toBeGreaterThanOrEqual(2_000);
  });

  it('dead letters a command that always fails, and an operator resolves it', async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('poison-0001')));
    await writePath.settle();
    expect(await finalStatus(operationId)).toMatchObject({ state: 'DEAD_LETTERED', attempts: 5 });
    expect(writePath.deadLetters).toHaveLength(1);
    // The local stand in for the dlq:resolve author gate (WQ1, WE7): an
    // operator discards it, and it ends FAILED with the dead letter gone.
    const operator = writePath.operator();
    const [deadLetter] = await operator.inspectMessages();
    expect(deadLetter?.view).toMatchObject({ kind: 'operation', operationId, flagged: false });
    expect(
      await operator.resolve(
        deadLetter?.message ?? { messageId: '', receiptHandle: '', body: '' },
        'discard',
      ),
    ).toBe('discarded');
    expect(await finalStatus(operationId)).toMatchObject({
      state: 'FAILED',
      failure: { code: 'operator-discarded' },
      attempts: 5,
    });
    expect(writePath.deadLetters).toEqual([]);
  });

  it('applies with the relay disabled, as in test: the sweep moves it, SweepRecovered counted', async () => {
    startWritePath(false);
    expect(writePath.metrics).toContainEqual(['absent', 'relay']);
    const { operationId } = accepted(await writePath.submit(await summaryReplace('record-0001')));
    await writePath.settle();
    expect((await finalStatus(operationId)).state).toBe('ACCEPTED');
    writePath.advanceTime(61_000);
    await writePath.runSweep();
    await writePath.settle();
    expect((await finalStatus(operationId)).state).toBe('SUCCEEDED');
    expect(writePath.metrics.filter((entry) => entry[0] === 'SweepRecovered')).toHaveLength(1);
  });

  it('applies five commands for one record in submission order, all SUCCEEDED', async () => {
    startWritePath();
    // Each written against the version the one before leaves (WE5 finding).
    let sections = await providerSections('provider-a', 'record-0001');
    const operationIds: string[] = [];
    for (const ordinal of [1, 2, 3, 4, 5]) {
      const summary = {
        title: `Synthetic ordered WE9 ${String(ordinal)}`,
        status: 'active' as const,
      };
      operationIds.push(
        accepted(
          await writePath.submit(
            {
              type: 'record.section.replace',
              recordId: 'record-0001',
              section: 'summary',
              baseVersion: computeProviderVersion(sections),
              payload: summary,
            },
            { idempotencyKey: `00000000-0000-4000-8000-00000000091${String(ordinal)}` },
          ),
        ).operationId,
      );
      sections = { ...sections, summary };
    }
    await writePath.settle();
    for (const operationId of operationIds) {
      expect((await finalStatus(operationId)).state).toBe('SUCCEEDED');
    }
    // The provider saw them in submission order.
    expect(writePath.providerCalls.map((call) => call.operationId)).toEqual(operationIds);
    expect((await providerSections('provider-a', 'record-0001')).summary).toEqual({
      title: 'Synthetic ordered WE9 5',
      status: 'active',
    });
  });

  it("answers another tenant's poll 404", async () => {
    startWritePath();
    const { operationId } = accepted(await writePath.submit(await summaryReplace('record-0001')));
    expect((await writePath.status(operationId, 'tenant-2')).statusCode).toBe(404);
  });
});
